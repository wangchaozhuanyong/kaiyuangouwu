import type {
    StoreCouponUsageRecord,
    StoreCustomerCoupon,
    StorefrontCouponCampaign,
    StorefrontLanguage,
} from './types';

export type CouponCenterTab = 'ACTIVITIES' | 'UNCLAIMED' | 'UNUSED' | 'HISTORY';

export interface CouponCampaignActionState {
    canClaim: boolean;
    label: string;
    detail?: string;
}

export type CouponOwnershipLoadState = 'ready' | 'loading' | 'error';

export function couponCampaignsForCustomer(
    campaigns: StorefrontCouponCampaign[],
    coupons: StoreCustomerCoupon[],
): StorefrontCouponCampaign[] {
    const claimedCampaignIds = new Set(coupons.map(coupon => coupon.campaignId));
    return campaigns.map(campaign => {
        const claimed = claimedCampaignIds.has(campaign.id);
        return {
            ...campaign,
            claimed,
            claimable: claimed ? false : campaign.claimable,
        };
    });
}

export function couponCampaignActionState(
    campaign: StorefrontCouponCampaign,
    language: StorefrontLanguage,
    ownershipLoadState: CouponOwnershipLoadState = 'ready',
): CouponCampaignActionState {
    const isZh = language === 'zh';
    if (ownershipLoadState === 'loading') {
        return { canClaim: false, label: isZh ? '核验中' : 'Checking' };
    }
    if (ownershipLoadState === 'error') {
        return {
            canClaim: false,
            label: isZh ? '状态异常' : 'Unavailable',
            detail: isZh ? '请重试' : 'Retry required',
        };
    }
    if (campaign.claimed) {
        return { canClaim: false, label: isZh ? '已领' : 'Claimed' };
    }
    if (campaign.claimable) {
        return { canClaim: true, label: isZh ? '立即领取' : 'Claim' };
    }
    return {
        canClaim: false,
        label: isZh ? '已领完' : 'Sold out',
        detail: isZh ? '本账号未领' : 'Not claimed by this account',
    };
}

export function claimableCouponCampaigns(campaigns: StorefrontCouponCampaign[]): StorefrontCouponCampaign[] {
    return campaigns.filter(campaign => !campaign.claimed && campaign.claimable);
}

export function markCouponCampaignClaimed(
    campaigns: StorefrontCouponCampaign[],
    campaignId: string,
): StorefrontCouponCampaign[] {
    return campaigns.map(campaign =>
        campaign.id === campaignId ? { ...campaign, claimed: true, claimable: false } : campaign,
    );
}

export function couponCampaignsForTab(
    campaigns: StorefrontCouponCampaign[],
    tab: CouponCenterTab,
): StorefrontCouponCampaign[] {
    if (tab === 'UNCLAIMED') return claimableCouponCampaigns(campaigns);
    if (tab === 'ACTIVITIES') {
        return campaigns.filter(campaign => campaign.claimed || campaign.claimable);
    }
    return [];
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
