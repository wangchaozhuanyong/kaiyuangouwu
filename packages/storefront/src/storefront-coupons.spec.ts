import { describe, expect, it } from 'vitest';

import {
    couponCardFromCustomerCoupon,
    couponCardFromUsageRecord,
    couponCardsFromBlock,
    couponCardsFromCampaigns,
    couponScopeLabel,
} from './storefront-coupons';
import { StorefrontContentBlock } from './types';

function couponBlock(): StorefrontContentBlock {
    return {
        id: 'coupons',
        code: 'home-coupons',
        type: 'COUPONS',
        enabled: true,
        position: 0,
        startsAt: null,
        endsAt: null,
        imageUrl: null,
        backgroundColor: null,
        textColor: null,
        targetType: 'NONE',
        targetValue: null,
        title: '专享特惠专区',
        subtitle: '新人专享',
        body: '结算时使用',
        ctaLabel: '',
        items: [
            {
                id: 'coupon-1',
                enabled: true,
                position: 0,
                imageUrl: null,
                targetType: 'COUPON',
                targetValue: 'WELCOME15',
                label: '8.5折',
                description: '全场活动券',
            },
            {
                id: 'link-1',
                enabled: true,
                position: 1,
                imageUrl: null,
                targetType: 'URL',
                targetValue: '/sale',
                label: '活动链接',
                description: '',
            },
        ],
    };
}

describe('storefront coupons', () => {
    it('maps only coupon targets into the existing ticket design', () => {
        expect(couponCardsFromBlock(couponBlock(), 'zh')).toEqual([
            expect.objectContaining({
                id: 'coupon-1',
                campaignId: 'WELCOME15',
                value: '8.5',
                unit: '折',
                unitBefore: false,
                tag: '新人专享',
            }),
        ]);
    });

    it('maps real promotion campaigns into the same coupon ticket design', () => {
        expect(
            couponCardsFromCampaigns(
                [
                    {
                        id: 'campaign-1',
                        name: '新客满减',
                        kind: 'ORDER_FIXED',
                        startsAt: null,
                        endsAt: null,
                        claimStartsAt: null,
                        claimEndsAt: null,
                        validityDays: null,
                        minimumSpend: 10_000,
                        discountAmount: 2_000,
                        discountRate: null,
                        remainingIssueCount: null,
                        claimed: false,
                        claimable: true,
                    },
                    {
                        id: 'campaign-2',
                        name: '数码专享',
                        kind: 'COLLECTION_PERCENTAGE',
                        startsAt: null,
                        endsAt: null,
                        claimStartsAt: null,
                        claimEndsAt: null,
                        validityDays: null,
                        minimumSpend: 0,
                        discountAmount: null,
                        discountRate: 8.5,
                        remainingIssueCount: null,
                        claimed: false,
                        claimable: true,
                    },
                ],
                'zh',
                'CNY',
            ),
        ).toEqual([
            expect.objectContaining({
                campaignId: 'campaign-1',
                value: '20',
                unit: '¥',
                unitBefore: true,
                description: '满 ¥100 可用',
                claimed: false,
                claimable: true,
            }),
            expect.objectContaining({
                campaignId: 'campaign-2',
                value: '8.5',
                unit: '折',
                tag: '分类折扣券',
            }),
        ]);
    });

    it('never makes an already-claimed campaign claimable in the ticket UI', () => {
        const [card] = couponCardsFromCampaigns(
            [
                {
                    id: 'repeatable-campaign',
                    name: '已领取活动',
                    kind: 'ORDER_FIXED',
                    startsAt: null,
                    endsAt: null,
                    claimStartsAt: null,
                    claimEndsAt: null,
                    validityDays: null,
                    minimumSpend: 0,
                    discountAmount: 500,
                    discountRate: null,
                    remainingIssueCount: 10,
                    claimed: true,
                    claimable: true,
                },
            ],
            'zh',
            'CNY',
        );

        expect(card).toMatchObject({ claimed: true, claimable: false });
    });

    it('shows coupons regardless of their name and hides invalid no-op discounts', () => {
        const campaigns = [
            {
                id: 'test-campaign',
                name: '测试满减',
                kind: 'ORDER_FIXED' as const,
                startsAt: null,
                endsAt: null,
                claimStartsAt: null,
                claimEndsAt: null,
                validityDays: null,
                minimumSpend: 0,
                discountAmount: 100,
                discountRate: null,
                remainingIssueCount: null,
                claimed: false,
                claimable: true,
            },
            {
                id: 'no-op-campaign',
                name: '无效折扣',
                kind: 'ORDER_PERCENTAGE' as const,
                startsAt: null,
                endsAt: null,
                claimStartsAt: null,
                claimEndsAt: null,
                validityDays: null,
                minimumSpend: 0,
                discountAmount: null,
                discountRate: 10,
                remainingIssueCount: null,
                claimed: false,
                claimable: true,
            },
        ];

        expect(couponCardsFromCampaigns(campaigns, 'zh', 'CNY')).toEqual([
            expect.objectContaining({ campaignId: 'test-campaign', title: '测试满减', value: '1' }),
        ]);
    });

    it('maps an owned coupon into the same ticket design without making it claimable', () => {
        const card = couponCardFromCustomerCoupon(
            {
                id: 'coupon-1',
                campaignId: 'campaign-1',
                campaignName: '新客满减',
                campaignKind: 'ORDER_FIXED',
                status: 'AVAILABLE',
                minimumSpend: 10_000,
                discountAmount: 2_000,
                discountRate: null,
                claimedAt: '2026-08-26T00:00:00.000Z',
                validFrom: '2026-08-26T00:00:00.000Z',
                validUntil: '2026-09-02T00:00:00.000Z',
                lockedAt: null,
                usedAt: null,
                returnedAt: null,
                expiredAt: null,
                lockedOrderId: null,
                usedOrderId: null,
                returnCount: 0,
                usable: true,
            },
            'zh',
            'CNY',
        );

        expect(card).toMatchObject({
            value: '20',
            unit: '¥',
            description: '满 ¥100 可用',
            claimed: true,
            claimable: false,
        });
        expect(couponScopeLabel('PRODUCT_PERCENTAGE', 'zh')).toBe('指定商品');
    });

    it('keeps a refunded usage record renderable after the coupon returns to unused', () => {
        const card = couponCardFromUsageRecord(
            {
                id: 'allocation-1',
                customerCouponId: 'coupon-1',
                campaignId: 'campaign-1',
                campaignName: '退款返券活动',
                campaignKind: 'ORDER_FIXED',
                status: 'REFUNDED',
                currencyCode: 'CNY',
                minimumSpend: 10_000,
                discountAmount: 1_000,
                discountRate: null,
                savedAmount: 1_000,
                usedAt: '2026-08-26T00:00:00.000Z',
                refundedAt: '2026-08-27T00:00:00.000Z',
                orderId: 'order-1',
                orderCode: 'T0001',
            },
            'zh',
        );

        expect(card).toMatchObject({ title: '退款返券活动', value: '10', claimable: false });
    });
});
