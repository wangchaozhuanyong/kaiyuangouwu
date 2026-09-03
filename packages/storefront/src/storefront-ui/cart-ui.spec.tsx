import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { StoreCustomerCoupon } from '../types';

import { CouponSheet } from './cart-ui';

const handlers = {
    onApply: vi.fn().mockResolvedValue(null),
    onRemove: vi.fn().mockResolvedValue(null),
    onBrowseCoupons: vi.fn(),
    onClose: vi.fn(),
};

function coupon(overrides: Partial<StoreCustomerCoupon> = {}): StoreCustomerCoupon {
    return {
        id: 'coupon-1',
        campaignId: 'campaign-1',
        campaignName: '新客优惠券',
        campaignKind: 'ORDER_FIXED',
        status: 'AVAILABLE',
        minimumSpend: 1000,
        currencyCode: 'MYR',
        discountAmount: 500,
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
        ...overrides,
    };
}

function renderCouponSheet(coupons: StoreCustomerCoupon[]) {
    return renderToStaticMarkup(
        createElement(CouponSheet, {
            coupons,
            orderId: 'order-1',
            language: 'zh',
            loading: false,
            ...handlers,
        }),
    );
}

describe('CouponSheet', () => {
    it('renders the selected guided empty-state design', () => {
        const markup = renderCouponSheet([]);

        expect(markup).toContain('coupon-selector-sheet');
        expect(markup).toContain('当前无可用优惠券');
        expect(markup).toContain('还没有可用优惠券');
        expect(markup).toContain('去领券中心看看，领取后即可在结算时选择使用');
        expect(markup).toContain('领券后返回结算页，系统会自动刷新');
        expect(markup).toContain('去领券中心');
        expect(markup).toContain('本次不用优惠券');
    });

    it('preserves the selectable coupon list when a coupon is available', () => {
        const markup = renderCouponSheet([coupon()]);

        expect(markup).toContain('我的优惠券');
        expect(markup).toContain('新客优惠券');
        expect(markup).toContain('使用');
        expect(markup).not.toContain('还没有可用优惠券');
    });

    it('shows every owned coupon while disabling coupons that cannot be selected', () => {
        const markup = renderCouponSheet([
            coupon(),
            coupon({
                id: 'coupon-2',
                campaignName: '已过期优惠券',
                status: 'EXPIRED',
                expiredAt: '2026-09-03T00:00:00.000Z',
                usable: false,
            }),
            coupon({
                id: 'coupon-3',
                campaignName: '其他订单优惠券',
                status: 'LOCKED',
                lockedAt: '2026-09-03T00:00:00.000Z',
                lockedOrderId: 'order-2',
                usable: false,
            }),
        ]);

        expect(markup).toContain('新客优惠券');
        expect(markup).toContain('已过期优惠券');
        expect(markup).toContain('其他订单优惠券');
        expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>已过期<\/button>/);
        expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>其他订单使用中<\/button>/);
    });
});
