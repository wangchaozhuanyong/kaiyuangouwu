// organize-imports-ignore -- Preserve the ESLint type-import groups.
import type { StoreCustomerCoupon, StorefrontCouponCampaign, StorefrontLanguage } from './types';
import type { QueryClient, QueryKey } from '@tanstack/react-query';

import { markCouponCampaignClaimed } from './coupon-center-state';
import { ShopApiGraphQlError } from './shop-api-errors';
import { storefrontErrorCode, storefrontErrorMessage } from './storefront-errors';

interface CouponClaimApi {
    claimCoupon(campaignId: string): Promise<StoreCustomerCoupon>;
    myCoupons(): Promise<StoreCustomerCoupon[]>;
}

export type CouponClaimVerificationResult =
    | {
          status: 'verified';
          claimedCoupon: StoreCustomerCoupon;
          coupons: StoreCustomerCoupon[];
      }
    | {
          status: 'missing';
          claimedCoupon: StoreCustomerCoupon | null;
          coupons: StoreCustomerCoupon[];
      }
    | {
          status: 'lookup-failed';
          claimedCoupon: StoreCustomerCoupon | null;
      };

export function isDefiniteCouponClaimRejection(error: unknown): boolean {
    return (
        error instanceof ShopApiGraphQlError &&
        (error.requestNotExecuted ||
            ['USER_INPUT_ERROR', 'FORBIDDEN', 'UNAUTHORIZED'].includes(storefrontErrorCode(error) ?? ''))
    );
}

export function couponClaimVerificationMessage(
    status: 'lookup-failed' | 'missing' | 'refresh-failed',
    language: StorefrontLanguage,
): string {
    if (status === 'refresh-failed')
        return language === 'zh'
            ? '优惠券已领取，但数据更新暂未完成，请稍后刷新查看。'
            : 'Your coupon was claimed, but data could not refresh. Check again shortly.';
    if (status === 'missing')
        return language === 'zh'
            ? '领取结果待核验，未在当前账号查到该优惠券。再次点击仅查询，不会重复领取；仍未显示请联系客服。'
            : 'The coupon was not found on this account. Click again to check without another claim; contact support if unresolved.';
    return language === 'zh'
        ? '领取结果待核验。再次点击仅核验当前账号权益，不会重复领取；仍无法确认请联系客服。'
        : 'The claim result could not be verified. Click again to check without another claim; contact support if unresolved.';
}

export async function claimAndVerifyCoupon(
    api: CouponClaimApi,
    campaignId: string,
    previousClaim?: StoreCustomerCoupon | null,
): Promise<CouponClaimVerificationResult> {
    // A previous receipt (or an unknown transport result) permits reads only.
    const claimedCoupon = previousClaim === undefined ? await api.claimCoupon(campaignId) : previousClaim;
    let coupons: StoreCustomerCoupon[];
    try {
        coupons = await api.myCoupons();
    } catch {
        return { status: 'lookup-failed', claimedCoupon };
    }
    const persisted = coupons.find(
        coupon => coupon.campaignId === campaignId && (!claimedCoupon || coupon.id === claimedCoupon.id),
    );
    return persisted
        ? { status: 'verified', claimedCoupon: persisted, coupons }
        : { status: 'missing', claimedCoupon, coupons };
}

/** Loaded by an explicit claim action; presentation and the Query cache share one completion. */
export async function completeCouponClaim({
    api,
    campaignId,
    pending,
    isCurrent,
    queryClient,
    customerCouponQueryKey,
    couponCampaignsQueryKey,
    refresh,
    language,
    notify,
}: {
    api: CouponClaimApi;
    campaignId: string;
    pending: Map<string, StoreCustomerCoupon | null>;
    isCurrent: () => boolean;
    queryClient: QueryClient;
    customerCouponQueryKey: QueryKey;
    couponCampaignsQueryKey: QueryKey;
    refresh: () => Promise<unknown>;
    language: StorefrontLanguage;
    notify: (message: string) => void;
}): Promise<string | null> {
    const isZh = language === 'zh';
    let verified = false;
    let refreshFailureMessage = '';
    try {
        refreshFailureMessage = couponClaimVerificationMessage('refresh-failed', language);
        if (!isCurrent()) return null;
        const previous = pending.has(campaignId) ? (pending.get(campaignId) ?? null) : undefined;
        // This tracks an in-progress write receipt, never a second query cache.
        pending.set(campaignId, previous ?? null);
        let result;
        try {
            result = await claimAndVerifyCoupon(api, campaignId, previous);
        } catch (error) {
            if (!isCurrent()) return null;
            if (isDefiniteCouponClaimRejection(error)) {
                pending.delete(campaignId);
                await refresh();
                return isCurrent() ? storefrontErrorMessage(error, language) : null;
            }
            // A lost response does not establish whether the write committed.
            result = await claimAndVerifyCoupon(api, campaignId, null);
        }
        if (!isCurrent()) return null;
        pending.set(campaignId, result.claimedCoupon);
        if (result.status !== 'lookup-failed') {
            queryClient.setQueryData<StoreCustomerCoupon[]>(customerCouponQueryKey, result.coupons);
        } else {
            void queryClient.invalidateQueries({ queryKey: customerCouponQueryKey });
        }
        if (result.status === 'verified') {
            verified = true;
            queryClient.setQueryData<StorefrontCouponCampaign[]>(couponCampaignsQueryKey, campaigns =>
                campaigns ? markCouponCampaignClaimed(campaigns, campaignId) : campaigns,
            );
        }
        await refresh();
        if (!isCurrent()) return null;
        if (
            verified &&
            [customerCouponQueryKey, couponCampaignsQueryKey].some(
                queryKey => queryClient.getQueryState(queryKey)?.status === 'error',
            )
        ) {
            return couponClaimVerificationMessage('refresh-failed', language);
        }
        if (result.status === 'lookup-failed') {
            return couponClaimVerificationMessage(result.status, language);
        }
        if (result.status === 'missing') {
            return couponClaimVerificationMessage(result.status, language);
        }
        notify(isZh ? '优惠券领取成功' : 'Coupon claimed');
        return null;
    } catch (requestError) {
        if (!isCurrent()) return null;
        if (verified) return refreshFailureMessage;
        return requestError instanceof Error
            ? storefrontErrorMessage(requestError, language)
            : storefrontErrorMessage(undefined, language);
    }
}
