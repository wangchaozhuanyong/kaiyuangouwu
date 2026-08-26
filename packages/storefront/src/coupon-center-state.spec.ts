import { describe, expect, it } from 'vitest';
import type { StoreCustomerCoupon, StorefrontCouponCampaign } from './types';

import { couponCampaignsForTab, customerCouponsForTab, isLockedCoupon } from './coupon-center-state';

const campaign = (claimed: boolean, claimable: boolean): StorefrontCouponCampaign => ({
    id: `${claimed}-${claimable}`,
    name: '活动',
    kind: 'ORDER_FIXED',
    startsAt: null,
    endsAt: null,
    claimStartsAt: null,
    claimEndsAt: null,
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
        expect(
            couponCampaignsForTab(
                [campaign(false, true), campaign(true, true), campaign(false, false)],
                'UNCLAIMED',
            ),
        ).toHaveLength(1);
    });

    it('keeps available, returned and locked coupons in the usable lifecycle view', () => {
        expect(
            customerCouponsForTab(
                [
                    coupon('AVAILABLE'),
                    coupon('RETURNED'),
                    coupon('LOCKED'),
                    coupon('USED'),
                    coupon('EXPIRED'),
                ],
                'USABLE',
            ).map(item => item.status),
        ).toEqual(['AVAILABLE', 'RETURNED', 'LOCKED']);
    });

    it('recognizes a locked coupon without depending on a checkout order object', () => {
        expect(isLockedCoupon(coupon('LOCKED'))).toBe(true);
    });
});
