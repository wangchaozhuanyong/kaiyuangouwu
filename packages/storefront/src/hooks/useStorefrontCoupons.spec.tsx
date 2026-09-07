// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ShopApi } from '../api';
import { enabledMarkets } from '../i18n';
import {
    ActiveCustomer,
    Order,
    StoreCustomerCoupon,
    StorefrontCart,
    StorefrontCouponCampaign,
} from '../types';

import { useStorefrontCoupons } from './useStorefrontCoupons';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Options = Parameters<typeof useStorefrontCoupons>[0];

describe('storefront coupon coordination', () => {
    let root: ReturnType<typeof createRoot>;
    let client: QueryClient;
    let value: ReturnType<typeof useStorefrontCoupons>;
    let options: Options;
    const coupon = {
        id: 'coupon-a',
        campaignId: 'campaign-a',
        campaignName: '活动券',
        status: 'AVAILABLE',
        usable: true,
        lockedOrderId: null,
    } as StoreCustomerCoupon;
    const campaign = { id: 'campaign-a', claimed: false, claimable: true } as StorefrontCouponCampaign;
    const api = {
        claimCoupon: vi.fn(),
        myCoupons: vi.fn(),
        applyCustomerCoupon: vi.fn(),
        removeCustomerCoupon: vi.fn(),
        applyBestCustomerCoupon: vi.fn(),
    };
    function Harness() {
        value = useStorefrontCoupons(options);
        return null;
    }
    async function render() {
        await act(async () => {
            root.render(
                <QueryClientProvider client={client}>
                    <Harness />
                </QueryClientProvider>,
            );
            await Promise.resolve();
        });
    }
    beforeEach(() => {
        vi.resetAllMocks();
        api.claimCoupon.mockResolvedValue(coupon);
        api.myCoupons.mockResolvedValue([coupon]);
        api.applyBestCustomerCoupon.mockResolvedValue(null);
        client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        root = createRoot(document.createElement('div'));
        options = {
            api: api as unknown as ShopApi,
            market: enabledMarkets[0],
            language: 'zh',
            vendureLanguageCode: 'zh_Hans',
            storefrontContextResolved: true,
            cart: {
                id: 'cart-a',
                revision: 1,
                state: 'OPEN',
                checkoutOrder: { id: 'order-a', lines: [{}] } as Order,
            } as StorefrontCart,
            cartState: { pending: false },
            route: { name: 'home' },
            customer: { id: 'customer-a' } as ActiveCustomer,
            myCoupons: [coupon],
            customerCouponsQuery: { isPending: false },
            customerCouponQueryKey: ['customer-a', 'coupons'],
            couponCampaignsQueryKey: ['customer-a', 'campaigns'],
            notify: vi.fn(),
            navigate: vi.fn(),
            refreshCart: vi.fn(),
            setCartLoading: vi.fn(),
            setCartError: vi.fn(),
        };
        client.setQueryData(options.couponCampaignsQueryKey, [campaign]);
    });
    afterEach(() => {
        act(() => root.unmount());
        client.clear();
    });

    it('does not claim for a guest and routes to sign in', async () => {
        options.customer = null;
        await render();
        expect(await value.claimCoupon(campaign.id)).toContain('请先登录');
        expect(options.navigate).toHaveBeenCalledWith({ name: 'login' });
        expect(api.claimCoupon).not.toHaveBeenCalled();
    });

    it('marks a campaign claimed only after verifying coupon ownership', async () => {
        await render();
        expect(await value.claimCoupon(campaign.id)).toBeNull();
        expect(client.getQueryData(options.customerCouponQueryKey)).toEqual([coupon]);
        expect(client.getQueryData(options.couponCampaignsQueryKey)).toEqual([
            { ...campaign, claimed: true, claimable: false },
        ]);
        expect(options.notify).toHaveBeenCalledWith('优惠券领取成功');
        expect(options.setCartLoading).toHaveBeenLastCalledWith(false);
    });

    it('reports a missing owned coupon without marking the campaign as claimed', async () => {
        api.myCoupons.mockResolvedValue([]);
        await render();
        expect(await value.claimCoupon(campaign.id)).toContain('未在当前账号查到');
        expect(client.getQueryData(options.couponCampaignsQueryKey)).toEqual([campaign]);
        expect(options.notify).not.toHaveBeenCalled();
        expect(options.setCartLoading).toHaveBeenLastCalledWith(false);
    });

    it('preserves cached ownership and avoids a success message when verification fails', async () => {
        api.myCoupons.mockRejectedValue(new Error('Lookup unavailable'));
        client.setQueryData(options.customerCouponQueryKey, [coupon]);
        await render();
        expect(await value.claimCoupon(campaign.id)).toContain('权益核验失败');
        expect(client.getQueryData(options.customerCouponQueryKey)).toEqual([coupon]);
        expect(client.getQueryData(options.couponCampaignsQueryKey)).toEqual([campaign]);
        expect(options.notify).not.toHaveBeenCalled();
    });

    it('attempts automatic selection once and respects manual removal for the same order', async () => {
        options.route = { name: 'cart' };
        await render();
        await render();
        expect(api.applyBestCustomerCoupon).toHaveBeenCalledTimes(1);
        await value.removeCoupon(coupon.id);
        if (!options.cart) throw new Error('Missing cart fixture');
        options.cart = { ...options.cart, revision: 2 };
        await render();
        expect(api.applyBestCustomerCoupon).toHaveBeenCalledTimes(1);
        expect(api.removeCustomerCoupon).toHaveBeenCalledWith(coupon.id);
    });

    it('waits for pending cart commands before applying the best coupon', async () => {
        options.route = { name: 'cart' };
        options.cartState = { pending: true };
        await render();
        expect(api.applyBestCustomerCoupon).not.toHaveBeenCalled();
        options.cartState = { pending: false };
        await render();
        expect(api.applyBestCustomerCoupon).toHaveBeenCalledTimes(1);
    });

    it('keeps a late auto-selection response scoped to its original customer', async () => {
        let resolve!: (coupon: StoreCustomerCoupon | null) => void;
        api.applyBestCustomerCoupon.mockReturnValueOnce(
            new Promise(done => {
                resolve = done;
            }),
        );
        options.route = { name: 'cart' };
        const originalKey = options.customerCouponQueryKey;
        client.setQueryData(originalKey, [coupon]);
        await render();
        options = {
            ...options,
            customer: { id: 'customer-b' } as ActiveCustomer,
            customerCouponQueryKey: ['customer-b', 'coupons'],
        };
        await render();
        const locked = { ...coupon, status: 'LOCKED', lockedOrderId: 'order-a' } as StoreCustomerCoupon;
        await act(async () => {
            resolve(locked);
            await Promise.resolve();
        });
        expect(client.getQueryData(originalKey)).toEqual([locked]);
        expect(client.getQueryData(options.customerCouponQueryKey)).toBeUndefined();
        expect(options.notify).not.toHaveBeenCalled();
    });
});
