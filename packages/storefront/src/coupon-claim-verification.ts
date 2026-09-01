import type { StoreCustomerCoupon } from './types';

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
          claimedCoupon: StoreCustomerCoupon;
          coupons: StoreCustomerCoupon[];
      }
    | {
          status: 'lookup-failed';
          claimedCoupon: StoreCustomerCoupon;
      };

export async function claimAndVerifyCoupon(
    api: CouponClaimApi,
    campaignId: string,
): Promise<CouponClaimVerificationResult> {
    const claimedCoupon = await api.claimCoupon(campaignId);
    let coupons: StoreCustomerCoupon[];
    try {
        coupons = await api.myCoupons();
    } catch {
        return { status: 'lookup-failed', claimedCoupon };
    }
    const persisted = coupons.some(
        coupon => coupon.id === claimedCoupon.id && coupon.campaignId === campaignId,
    );
    return persisted
        ? { status: 'verified', claimedCoupon, coupons }
        : { status: 'missing', claimedCoupon, coupons };
}
