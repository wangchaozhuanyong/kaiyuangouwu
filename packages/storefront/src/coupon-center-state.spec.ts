import { describe, expect, it } from 'vitest';

import {
    claimableCouponCampaigns,
    couponCampaignActionState,
    couponCampaignsForCustomer,
    couponCampaignsForTab,
    couponCenterTabCount,
    customerCouponsForTab,
    isLockedCoupon,
    markCouponCampaignClaimed,
} from './coupon-center-state';
import { type StoreCustomerCoupon, type StorefrontCouponCampaign } from './types';

const campaign = (claimed: boolean, claimable: boolean): StorefrontCouponCampaign => ({
    id: `${claimed}-${claimable}`,
    name: '活动',
    kind: 'ORDER_FIXED',
    startsAt: null,
    endsAt: null,
    claimStartsAt: null,
    claimEndsAt: null,
    validityDays: null,
    minimumSpend: 0,
    discountAmount: 100,
    discountRate: null,
    remainingIssueCount: null,
    claimed,
    claimable,
});

const coupon = (status: StoreCustomerCoupon['status']): StoreCustomerCoupon => ({
    id: status,
    campaignId: 'campaign',
    campaignName: '活动',
    campaignKind: 'ORDER_FIXED',
    status,
    minimumSpend: 0,
    discountAmount: 100,
    discountRate: null,
    claimedAt: '2026-08-26T00:00:00.000Z',
    validFrom: '2026-08-26T00:00:00.000Z',
    validUntil: null,
    lockedAt: status === 'LOCKED' ? '2026-08-26T01:00:00.000Z' : null,
    usedAt: null,
    returnedAt: null,
    expiredAt: null,
    lockedOrderId: status === 'LOCKED' ? 'order-1' : null,
    usedOrderId: null,
    returnCount: 0,
    usable: ['AVAILABLE', 'RETURNED'].includes(status),
});

describe('coupon center state', () => {
    it('separates unclaimed activities from already claimed or sold-out activities', () => {
        const campaigns = [campaign(false, true), campaign(true, true), campaign(false, false)];
        expect(claimableCouponCampaigns(campaigns)).toHaveLength(1);
        expect(couponCampaignsForTab(campaigns, 'UNCLAIMED')).toEqual(claimableCouponCampaigns(campaigns));
        expect(couponCampaignsForTab(campaigns, 'ACTIVITIES')).toHaveLength(2);
        expect(couponCampaignsForTab(campaigns, 'ACTIVITIES')).not.toContainEqual(
            expect.objectContaining({ claimed: false, claimable: false }),
        );
    });

    it('removes a verified claim from claimable campaigns without mutating the original data', () => {
        const claimedCampaign = { ...campaign(false, true), id: 'claimed-campaign' };
        const remainingCampaign = { ...campaign(false, true), id: 'remaining-campaign' };
        const campaigns = [claimedCampaign, remainingCampaign];

        const updated = markCouponCampaignClaimed(campaigns, claimedCampaign.id);

        expect(claimableCouponCampaigns(updated).map(item => item.id)).toEqual(['remaining-campaign']);
        expect(updated[0]).toMatchObject({ claimed: true, claimable: false });
        expect(campaigns[0]).toMatchObject({ claimed: false, claimable: true });
    });

    it('keeps available, returned and locked coupons in the unused lifecycle view', () => {
        expect(
            customerCouponsForTab(
                [
                    coupon('AVAILABLE'),
                    coupon('RETURNED'),
                    coupon('LOCKED'),
                    coupon('USED'),
                    coupon('EXPIRED'),
                ],
                'UNUSED',
            ).map(item => item.status),
        ).toEqual(['AVAILABLE', 'RETURNED', 'LOCKED']);
    });

    it('does not derive immutable usage history from mutable coupon status', () => {
        expect(customerCouponsForTab([coupon('USED'), coupon('RETURNED')], 'HISTORY')).toEqual([]);
        expect(couponCenterTabCount('HISTORY', [], [], [{ id: 'allocation-1' } as any])).toBe(1);
    });

    it('recognizes a locked coupon without depending on a checkout order object', () => {
        expect(isLockedCoupon(coupon('LOCKED'))).toBe(true);
    });

    it('derives claimed state from the current account instead of global campaign inventory', () => {
        const soldOutCampaign = {
            ...campaign(false, false),
            id: 'sold-out-campaign',
        };
        const firstAccountCoupon = {
            ...coupon('AVAILABLE'),
            id: 'first-account-coupon',
            campaignId: soldOutCampaign.id,
        };

        expect(couponCampaignsForCustomer([soldOutCampaign], [firstAccountCoupon])[0]).toMatchObject({
            claimed: true,
            claimable: false,
        });
        expect(couponCampaignsForCustomer([soldOutCampaign], [])[0]).toMatchObject({
            claimed: false,
            claimable: false,
        });
        expect(
            couponCampaignsForTab(
                couponCampaignsForCustomer([soldOutCampaign], [firstAccountCoupon]),
                'ACTIVITIES',
            ),
        ).toHaveLength(1);
        expect(
            couponCampaignsForTab(couponCampaignsForCustomer([soldOutCampaign], []), 'ACTIVITIES'),
        ).toEqual([]);
    });

    it('explains that a sold-out campaign was not claimed by the current account', () => {
        expect(couponCampaignActionState(campaign(false, false), 'zh')).toEqual({
            canClaim: false,
            label: '已领完',
            detail: '本账号未领',
        });
    });

    it('does not expose a claim action before current-account ownership is known', () => {
        expect(couponCampaignActionState(campaign(false, true), 'zh', 'loading')).toEqual({
            canClaim: false,
            label: '核验中',
        });
        expect(couponCampaignActionState(campaign(false, true), 'zh', 'error')).toEqual({
            canClaim: false,
            label: '状态异常',
            detail: '请重试',
        });
    });
});
