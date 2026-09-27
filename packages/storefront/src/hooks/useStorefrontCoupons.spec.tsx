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
    ProductVariant,
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
    async function remount() {
        act(() => root.unmount());
        root = createRoot(document.createElement('div'));
        await render();
    }
    beforeEach(() => {
        vi.resetAllMocks();
        sessionStorage.clear();
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
            customerAuthenticated: true,
            cart: {
                id: 'cart-a',
                revision: 1,
                state: 'OPEN',
                lines: [
                    {
                        id: 'cart-line-a',
                        quantity: 1,
                        selected: true,
                        available: true,
                        productVariant: {
                            id: 'variant-a',
                            priceWithTax: 10_000,
                            currencyCode: 'MYR',
                        } as ProductVariant,
                    },
                ],
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
        sessionStorage.clear();
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

    it('refreshes the order total after applying and removing a coupon', async () => {
        await render();
        expect(await value.applyCoupon(coupon.id)).toBeNull();
        expect(options.refreshCart).toHaveBeenCalledTimes(1);
        expect(await value.removeCoupon(coupon.id)).toBeNull();
        expect(options.refreshCart).toHaveBeenCalledTimes(2);
    });

    it('reports a changed coupon when the refreshed order total is unavailable', async () => {
        options.refreshCart = vi.fn().mockRejectedValueOnce(new Error('Network unavailable'));
        await render();
        expect(await value.applyCoupon(coupon.id)).toContain('优惠券已使用，但订单金额刷新失败');
        expect(options.notify).not.toHaveBeenCalled();
        expect(
            sessionStorage.getItem(`storefront:coupon-auto-selection-suppressed:${options.market.code}`),
        ).toBe('customer-a:cart-a:order-a');
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

    it('keeps manual removal after refresh and permits auto selection for a new checkout', async () => {
        await render();
        expect(await value.removeCoupon(coupon.id)).toBeNull();
        options.route = { name: 'cart' };
        await remount();
        expect(api.applyBestCustomerCoupon).not.toHaveBeenCalled();

        if (!options.cart) throw new Error('Missing cart fixture');
        options.cart = {
            ...options.cart,
            id: 'cart-b',
            checkoutOrder: { ...options.cart.checkoutOrder, id: 'order-b' } as Order,
        };
        await render();
        expect(api.applyBestCustomerCoupon).toHaveBeenCalledTimes(1);
    });

    it('does not persist a failed manual removal as a coupon choice', async () => {
        api.removeCustomerCoupon.mockRejectedValueOnce(new Error('Temporary failure'));
        await render();
        expect(await value.removeCoupon(coupon.id)).toBeTruthy();
        options.route = { name: 'cart' };
        await remount();
        expect(api.applyBestCustomerCoupon).toHaveBeenCalledTimes(1);
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

    it('keeps coupon loading until automatic selection refreshes the order', async () => {
        let resolve!: (selected: StoreCustomerCoupon | null) => void;
        api.applyBestCustomerCoupon.mockReturnValueOnce(new Promise(done => (resolve = done)));
        options.route = { name: 'cart' };
        await render();
        expect(options.setCartLoading).toHaveBeenCalledWith(true);
        expect(options.refreshCart).not.toHaveBeenCalled();

        await act(async () => {
            resolve({ ...coupon, status: 'LOCKED', lockedOrderId: 'order-a' });
            await Promise.resolve();
        });
        expect(options.refreshCart).toHaveBeenCalledTimes(1);
        expect(options.setCartLoading).toHaveBeenLastCalledWith(false);
    });

    it('shows a cart error if automatic selection succeeds but the order cannot refresh', async () => {
        api.applyBestCustomerCoupon.mockResolvedValueOnce({
            ...coupon,
            status: 'LOCKED',
            lockedOrderId: 'order-a',
        });
        options.refreshCart = vi.fn().mockRejectedValueOnce(new Error('Network unavailable'));
        options.route = { name: 'cart' };
        await render();
        expect(options.setCartError).toHaveBeenCalledWith(
            '优惠券已自动选择，但订单金额刷新失败，请刷新购物车后确认。',
        );
        expect(options.setCartLoading).toHaveBeenLastCalledWith(false);
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
    function changeQuantity(quantity: number) {
        if (!options.cart) throw new Error('Missing cart fixture');
        options.cart = {
            ...options.cart,
            revision: options.cart.revision + 1,
            lines: options.cart.lines.map(line => ({ ...line, quantity })),
        };
    }

    it('reselects a known automatic coupon when merchandise changes, without a revision feedback loop', async () => {
        const locked = {
            ...coupon,
            status: 'LOCKED',
            usable: false,
            lockedOrderId: 'order-a',
        } as StoreCustomerCoupon;
        api.applyBestCustomerCoupon.mockResolvedValue(locked);
        options.route = { name: 'cart' };
        await render();
        options.myCoupons = [locked];
        if (!options.cart) throw new Error('Missing cart fixture');
        options.cart = { ...options.cart, revision: 2 };
        await render();
        await remount();
        expect(api.applyBestCustomerCoupon).toHaveBeenCalledTimes(1);
        changeQuantity(2);
        await render();
        expect(api.applyBestCustomerCoupon).toHaveBeenCalledTimes(2);
        expect(options.notify).toHaveBeenCalledTimes(1);
        changeQuantity(3);
        const better = { ...locked, id: 'coupon-b', campaignName: '更优惠活动券' };
        api.applyBestCustomerCoupon.mockResolvedValueOnce(better);
        options.myCoupons = [locked, { ...better, status: 'AVAILABLE', usable: true, lockedOrderId: null }];
        await render();
        expect(api.applyBestCustomerCoupon).toHaveBeenCalledTimes(3);
        expect(options.notify).toHaveBeenLastCalledWith('已自动选择最优惠券：更优惠活动券');
    });

    it('refreshes totals when no coupon remains eligible after an automatic choice', async () => {
        const locked = {
            ...coupon,
            status: 'LOCKED',
            usable: false,
            lockedOrderId: 'order-a',
        } as StoreCustomerCoupon;
        api.applyBestCustomerCoupon.mockResolvedValueOnce(locked).mockResolvedValueOnce(null);
        options.route = { name: 'cart' };
        await render();
        options.myCoupons = [locked];
        changeQuantity(2);
        await render();
        expect(api.applyBestCustomerCoupon).toHaveBeenCalledTimes(2);
        expect(options.refreshCart).toHaveBeenCalledTimes(2);
        options.myCoupons = [coupon];
        await render();
        expect(api.applyBestCustomerCoupon).toHaveBeenCalledTimes(2);
    });

    it('preserves a manual selection after merchandise changes and remount', async () => {
        await render();
        expect(await value.applyCoupon(coupon.id)).toBeNull();
        options.route = { name: 'cart' };
        changeQuantity(2);
        await remount();
        expect(api.applyBestCustomerCoupon).not.toHaveBeenCalled();
    });

    it('does not replace an existing locked coupon with unknown selection provenance', async () => {
        options.myCoupons = [{ ...coupon, status: 'LOCKED', lockedOrderId: 'order-a' }];
        options.route = { name: 'cart' };
        await render();
        changeQuantity(2);
        await render();
        expect(api.applyBestCustomerCoupon).not.toHaveBeenCalled();
    });

    it.each(['price', 'selection', 'coupon-terms'] as const)(
        'rechecks %s changes while ignoring discount totals',
        async kind => {
            const locked = {
                ...coupon,
                status: 'LOCKED',
                usable: false,
                lockedOrderId: 'order-a',
            } as StoreCustomerCoupon;
            api.applyBestCustomerCoupon.mockResolvedValue(locked);
            options.route = { name: 'checkout' };
            await render();
            options.myCoupons = [locked];
            if (!options.cart?.checkoutOrder) throw new Error('Missing cart fixture');
            options.cart = {
                ...options.cart,
                revision: 3,
                checkoutOrder: { ...options.cart.checkoutOrder, totalWithTax: 9000, subTotalWithTax: 9000 },
            };
            await render();
            expect(api.applyBestCustomerCoupon).toHaveBeenCalledTimes(1);
            if (kind === 'coupon-terms') options.myCoupons = [{ ...locked, minimumSpend: 15000 }];
            else
                options.cart = {
                    ...options.cart,
                    lines: options.cart.lines.map(line => ({
                        ...line,
                        selected: kind === 'selection' ? false : line.selected,
                        productVariant: line.productVariant && {
                            ...line.productVariant,
                            priceWithTax: 20000,
                        },
                    })),
                };
            await render();
            expect(api.applyBestCustomerCoupon).toHaveBeenCalledTimes(2);
        },
    );

    it('rechecks a merchandise change that arrived during the preceding BEST request', async () => {
        let resolve!: (selected: StoreCustomerCoupon | null) => void;
        const locked = { ...coupon, status: 'LOCKED', lockedOrderId: 'order-a' } as StoreCustomerCoupon;
        api.applyBestCustomerCoupon
            .mockReturnValueOnce(new Promise(done => (resolve = done)))
            .mockResolvedValue(locked);
        options.route = { name: 'cart' };
        await render();
        changeQuantity(2);
        await render();
        expect(api.applyBestCustomerCoupon).toHaveBeenCalledTimes(1);
        await act(async () => {
            resolve(locked);
            await Promise.resolve();
        });
        expect(api.applyBestCustomerCoupon).toHaveBeenCalledTimes(2);
    });

    it('retries the failed total refresh after remount using automatic selection provenance', async () => {
        const locked = {
            ...coupon,
            status: 'LOCKED',
            usable: false,
            lockedOrderId: 'order-a',
        } as StoreCustomerCoupon;
        api.applyBestCustomerCoupon.mockResolvedValue(locked);
        options.refreshCart = vi
            .fn()
            .mockRejectedValueOnce(new Error('Temporary failure'))
            .mockResolvedValue(options.cart);
        options.route = { name: 'cart' };
        await render();
        options.myCoupons = [locked];
        await remount();
        expect(api.applyBestCustomerCoupon).toHaveBeenCalledTimes(2);
        expect(options.refreshCart).toHaveBeenCalledTimes(2);
    });
});
