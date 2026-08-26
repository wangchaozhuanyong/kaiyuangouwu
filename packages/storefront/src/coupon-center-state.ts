import type { StoreCustomerCoupon, StorefrontCouponCampaign } from './types';

export type CouponCenterTab = 'ACTIVITIES' | 'UNCLAIMED' | 'USABLE' | 'HISTORY';

export function couponCampaignsForTab(
    campaigns: StorefrontCouponCampaign[],
    tab: CouponCenterTab,
): StorefrontCouponCampaign[] {
    if (tab === 'UNCLAIMED') return campaigns.filter(campaign => !campaign.claimed && campaign.claimable);
    return tab === 'ACTIVITIES' ? campaigns : [];
}

export function customerCouponsForTab(
    coupons: StoreCustomerCoupon[],
    tab: CouponCenterTab,
): StoreCustomerCoupon[] {
    if (tab === 'USABLE') {
        return coupons.filter(coupon => ['AVAILABLE', 'RETURNED', 'LOCKED'].includes(coupon.status));
    }
    if (tab === 'HISTORY') {
        return coupons.filter(coupon => ['USED', 'EXPIRED', 'REVOKED'].includes(coupon.status));
    }
    return [];
}

export function couponCenterTabCount(
    tab: CouponCenterTab,
    campaigns: StorefrontCouponCampaign[],
    coupons: StoreCustomerCoupon[],
): number {
    return tab === 'ACTIVITIES' || tab === 'UNCLAIMED'
        ? couponCampaignsForTab(campaigns, tab).length
        : customerCouponsForTab(coupons, tab).length;
}

export function isLockedCoupon(coupon: StoreCustomerCoupon): boolean {
    return coupon.status === 'LOCKED';
}
