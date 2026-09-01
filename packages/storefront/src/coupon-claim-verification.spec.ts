import { describe, expect, it, vi } from 'vitest';

import { claimAndVerifyCoupon } from './coupon-claim-verification';
import { type StoreCustomerCoupon } from './types';

function coupon(id: string, campaignId = 'campaign-1'): StoreCustomerCoupon {
    return {
        id,
        campaignId,
        campaignName: '活动',
        campaignKind: 'ORDER_FIXED',
        status: 'AVAILABLE',
        minimumSpend: 0,
        discountAmount: 100,
        discountRate: null,
        claimedAt: '2026-09-01T00:00:00.000Z',
        validFrom: '2026-09-01T00:00:00.000Z',
        validUntil: null,
        lockedAt: null,
        usedAt: null,
        returnedAt: null,
        expiredAt: null,
        lockedOrderId: null,
        usedOrderId: null,
        returnCount: 0,
        usable: true,
    };
}

describe('claimAndVerifyCoupon', () => {
    it('reports success only when the claimed coupon is returned by the current-account query', async () => {
        const claimedCoupon = coupon('coupon-1');
        const api = {
            claimCoupon: vi.fn().mockResolvedValue(claimedCoupon),
            myCoupons: vi.fn().mockResolvedValue([claimedCoupon]),
        };

        await expect(claimAndVerifyCoupon(api, 'campaign-1')).resolves.toMatchObject({
            status: 'verified',
            coupons: [claimedCoupon],
        });
        expect(api.myCoupons).toHaveBeenCalledOnce();
    });

    it('does not report success when another account coupon list does not contain the claimed coupon', async () => {
        const api = {
            claimCoupon: vi.fn().mockResolvedValue(coupon('coupon-1')),
            myCoupons: vi.fn().mockResolvedValue([coupon('coupon-2', 'campaign-2')]),
        };

        await expect(claimAndVerifyCoupon(api, 'campaign-1')).resolves.toMatchObject({
            status: 'missing',
        });
    });

    it('keeps a successful mutation distinct from a failed ownership lookup', async () => {
        const api = {
            claimCoupon: vi.fn().mockResolvedValue(coupon('coupon-1')),
            myCoupons: vi.fn().mockRejectedValue(new Error('network unavailable')),
        };

        await expect(claimAndVerifyCoupon(api, 'campaign-1')).resolves.toMatchObject({
            status: 'lookup-failed',
        });
    });

    it('propagates a failed claim without running the ownership lookup', async () => {
        const api = {
            claimCoupon: vi.fn().mockRejectedValue(new Error('sold out')),
            myCoupons: vi.fn(),
        };

        await expect(claimAndVerifyCoupon(api, 'campaign-1')).rejects.toThrow('sold out');
        expect(api.myCoupons).not.toHaveBeenCalled();
    });
});
