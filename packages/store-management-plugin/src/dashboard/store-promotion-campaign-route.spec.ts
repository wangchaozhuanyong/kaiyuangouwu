import { describe, expect, it } from 'vitest';

import { couponIssuanceStatus, normalizeCouponRouteSearch } from './store-promotion-campaign-route';

describe('coupon route search', () => {
    const now = new Date('2026-08-29T12:00:00.000Z');

    it('applies stable defaults and removes unsupported values', () => {
        expect(
            normalizeCouponRouteSearch(
                {
                    view: 'unknown',
                    kind: 'INVALID',
                    status: 'INVALID',
                    eventType: 'INVALID',
                    from: 'not-a-date',
                    to: null,
                    page: -3,
                },
                now,
            ),
        ).toEqual({
            view: 'campaigns',
            q: '',
            kind: 'ALL',
            status: 'ALL',
            campaignId: 'ALL',
            eventType: 'ALL',
            from: '2026-07-31',
            to: '2026-08-29',
            page: 1,
        });
    });

    it('keeps supported view and filter values', () => {
        expect(
            normalizeCouponRouteSearch(
                {
                    view: 'ledger',
                    q: '暑期',
                    kind: 'ORDER_FIXED',
                    status: 'ACTIVE',
                    campaignId: 'campaign-1',
                    eventType: 'REDEEMED',
                    from: '2026-08-01',
                    to: '2026-08-20',
                    page: '4',
                },
                now,
            ),
        ).toEqual({
            view: 'ledger',
            q: '暑期',
            kind: 'ORDER_FIXED',
            status: 'ACTIVE',
            campaignId: 'campaign-1',
            eventType: 'REDEEMED',
            from: '2026-08-01',
            to: '2026-08-20',
            page: 4,
        });
    });
});

describe('coupon issuance status', () => {
    const now = Date.parse('2026-08-29T12:00:00.000Z');
    const activeCoupon = {
        enabled: true,
        claimStartsAt: '2026-08-01T00:00:00.000Z',
        claimEndsAt: '2026-09-01T00:00:00.000Z',
        remainingIssueCount: 20,
    };

    it('distinguishes active, scheduled, exhausted and stopped campaigns', () => {
        expect(couponIssuanceStatus(activeCoupon, now)).toBe('ACTIVE');
        expect(
            couponIssuanceStatus({ ...activeCoupon, claimStartsAt: '2026-09-01T00:00:00.000Z' }, now),
        ).toBe('SCHEDULED');
        expect(couponIssuanceStatus({ ...activeCoupon, remainingIssueCount: 0 }, now)).toBe('EXHAUSTED');
        expect(couponIssuanceStatus({ ...activeCoupon, enabled: false }, now)).toBe('STOPPED');
        expect(couponIssuanceStatus({ ...activeCoupon, claimEndsAt: '2026-08-20T00:00:00.000Z' }, now)).toBe(
            'STOPPED',
        );
    });
});
