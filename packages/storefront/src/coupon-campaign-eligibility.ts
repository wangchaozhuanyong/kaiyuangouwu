import type { StoreCustomerCoupon, StorefrontCouponCampaign } from './types';

export function couponCampaignsForCustomer(
    campaigns: StorefrontCouponCampaign[],
    coupons: StoreCustomerCoupon[],
): StorefrontCouponCampaign[] {
    const claimedCampaignIds = new Set(coupons.map(coupon => coupon.campaignId));
    return campaigns.map(campaign => {
        const claimed = campaign.claimed || claimedCampaignIds.has(campaign.id);
        return {
            ...campaign,
            claimed,
            claimable: claimed ? false : campaign.claimable,
        };
    });
}

export function claimableCouponCampaigns(
    campaigns: StorefrontCouponCampaign[],
    now = Date.now(),
): StorefrontCouponCampaign[] {
    return campaigns.filter(
        campaign =>
            !campaign.claimed &&
            campaign.claimable &&
            (campaign.remainingIssueCount == null || campaign.remainingIssueCount > 0) &&
            [campaign.startsAt, campaign.claimStartsAt].every(value => !value || Date.parse(value) <= now) &&
            [campaign.endsAt, campaign.claimEndsAt].every(value => !value || Date.parse(value) > now),
    );
}
