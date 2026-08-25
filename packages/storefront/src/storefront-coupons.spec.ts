import { describe, expect, it } from 'vitest';

import { couponCardsFromBlock, couponCardsFromCampaigns } from './storefront-coupons';
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
            }),
            expect.objectContaining({
                campaignId: 'campaign-2',
                value: '8.5',
                unit: '折',
                tag: '分类折扣券',
            }),
        ]);
    });

    it('hides test campaigns and invalid no-op discounts', () => {
        const campaigns = [
            {
                id: 'audit-campaign',
                name: '订单九折',
                kind: 'ORDER_PERCENTAGE' as const,
                startsAt: null,
                endsAt: null,
                claimStartsAt: null,
                claimEndsAt: null,
                minimumSpend: 0,
                discountAmount: null,
                discountRate: 9,
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
                minimumSpend: 0,
                discountAmount: null,
                discountRate: 10,
                remainingIssueCount: null,
                claimed: false,
                claimable: true,
            },
        ];

        expect(couponCardsFromCampaigns(campaigns, 'zh', 'CNY')).toEqual([]);
    });
});
