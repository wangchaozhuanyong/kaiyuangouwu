import type { StoreCouponUsageRecord, StoreCustomerCoupon, StorefrontCouponCampaign } from './types';

export type CouponCenterTab = 'ACTIVITIES' | 'UNCLAIMED' | 'UNUSED' | 'HISTORY';

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
    if (tab === 'UNUSED') {
        return coupons.filter(coupon => ['AVAILABLE', 'RETURNED', 'LOCKED'].includes(coupon.status));
    }
    return [];
}

export function couponCenterTabCount(
    tab: CouponCenterTab,
    campaigns: StorefrontCouponCampaign[],
    coupons: StoreCustomerCoupon[],
    usageRecords: StoreCouponUsageRecord[] = [],
): number {
    if (tab === 'ACTIVITIES' || tab === 'UNCLAIMED') {
        return couponCampaignsForTab(campaigns, tab).length;
    }
    return tab === 'HISTORY' ? usageRecords.length : customerCouponsForTab(coupons, tab).length;
}

export function isLockedCoupon(coupon: StoreCustomerCoupon): boolean {
    return coupon.status === 'LOCKED';
}
