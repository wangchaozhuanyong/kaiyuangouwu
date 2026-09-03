// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StoreCustomerCoupon } from '../types';

import { CouponSheet } from './cart-ui';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const coupon: StoreCustomerCoupon = {
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
};

describe('CouponSheet interactions', () => {
    let container: HTMLDivElement;
    let root: ReturnType<typeof createRoot>;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        document.body.innerHTML = '';
        vi.clearAllMocks();
    });

    it('applies the selected coupon and closes only after the request succeeds', async () => {
        const onApply = vi.fn().mockResolvedValue(null);
        const onClose = vi.fn();
        await act(async () => {
            root.render(
                <CouponSheet
                    coupons={[coupon]}
                    orderId="order-1"
                    language="zh"
                    loading={false}
                    onApply={onApply}
                    onRemove={vi.fn().mockResolvedValue(null)}
                    onBrowseCoupons={vi.fn()}
                    onClose={onClose}
                />,
            );
            await Promise.resolve();
        });

        const applyButton = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(
            button => button.textContent === '使用',
        );
        await act(async () => {
            applyButton?.click();
            await Promise.resolve();
        });

        expect(onApply).toHaveBeenCalledWith(coupon.id);
        expect(onClose).toHaveBeenCalledOnce();
    });
});
