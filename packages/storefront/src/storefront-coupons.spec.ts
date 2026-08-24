import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    couponCardsFromBlock,
    couponCardsFromCampaigns,
    readClaimedCouponCodes,
    storeClaimedCouponCodes,
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
    afterEach(() => vi.unstubAllGlobals());

    it('maps only coupon targets into the existing ticket design', () => {
        expect(couponCardsFromBlock(couponBlock(), 'zh')).toEqual([
            expect.objectContaining({
                id: 'coupon-1',
                code: 'WELCOME15',
                value: '8.5',
                unit: '折',
                unitBefore: false,
                tag: '新人专享',
            }),
        ]);
    });

    it('stores normalized claimed codes per storefront', () => {
        const storage = new Map<string, string>();
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => storage.set(key, value),
        });

        expect(storeClaimedCouponCodes('store-a', [' SAVE10 ', 'SAVE10', 'VIP20'])).toEqual([
            'SAVE10',
            'VIP20',
        ]);
        expect(readClaimedCouponCodes('store-a')).toEqual(['SAVE10', 'VIP20']);
        expect(readClaimedCouponCodes('store-b')).toEqual([]);
    });

    it('maps real promotion campaigns into the same coupon ticket design', () => {
        expect(
            couponCardsFromCampaigns(
                [
                    {
                        id: 'campaign-1',
                        name: '新客满减',
                        couponCode: 'NEW20',
                        kind: 'ORDER_FIXED',
                        startsAt: null,
                        endsAt: null,
                        minimumSpend: 10_000,
                        discountAmount: 2_000,
                        discountRate: null,
                    },
                    {
                        id: 'campaign-2',
                        name: '数码专享',
                        couponCode: 'DIGITAL85',
                        kind: 'COLLECTION_PERCENTAGE',
                        startsAt: null,
                        endsAt: null,
                        minimumSpend: 0,
                        discountAmount: null,
                        discountRate: 8.5,
                    },
                ],
                'zh',
                'CNY',
            ),
        ).toEqual([
            expect.objectContaining({
                code: 'NEW20',
                value: '20',
                unit: '¥',
                unitBefore: true,
                description: '满 ¥100 可用',
            }),
            expect.objectContaining({
                code: 'DIGITAL85',
                value: '8.5',
                unit: '折',
                tag: '分类折扣券',
            }),
        ]);
    });
});
