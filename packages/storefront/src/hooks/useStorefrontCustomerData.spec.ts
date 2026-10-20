import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ShopApi } from '../api';
import { enabledMarkets } from '../i18n';
import { storefrontQueryKeys } from '../query-client';
import { type ActiveCustomer } from '../types';

import { useStorefrontCustomerData } from './useStorefrontCustomerData';

const mocks = vi.hoisted(() => ({ useQuery: vi.fn() }));
vi.mock('@tanstack/react-query', async importOriginal => ({
    ...(await importOriginal<typeof import('@tanstack/react-query')>()),
    useQuery: mocks.useQuery,
}));

describe('customer query boundaries', () => {
    it('keeps a verified owned coupon hidden even if the activity refresh is stale', () => {
        customer = { id: 'buyer-a' } as ActiveCustomer;
        mocks.useQuery.mockImplementation(options => ({
            data: options.queryKey.includes('coupon-campaigns')
                ? [{ id: 'offer-a', claimed: false, claimable: true }]
                : options.queryKey.at(-1) === 'coupons'
                  ? [{ id: 'owned-a', campaignId: 'offer-a' }]
                  : undefined,
            isPending: false,
            isError: false,
            isPaused: false,
        }));
        const result = read('CNY', true, { activeRoute: 'home', homepageCoupons: true });
        expect(result.activeCoupons).toEqual([{ id: 'offer-a', claimed: true, claimable: false }]);
    });
    it.each([undefined, null, { id: 'buyer-a' } as ActiveCustomer])(
        'does not expose preloaded offers until identity is resolved: %s',
        identity => {
            customer = identity;
            const offers = [{ id: 'campaign-a', claimed: false, claimable: true }];
            mocks.useQuery.mockImplementation(options => ({
                data: options.queryKey.includes('coupon-campaigns') ? offers : undefined,
                isPending: false,
                isError: false,
                isPaused: false,
            }));
            const result = read('CNY', true, { activeRoute: 'home', homepageCoupons: true });
            expect(result.activeCoupons).toEqual(identity === undefined ? [] : offers);
        },
    );
    let customer: ActiveCustomer | null | undefined;
    let identityError: Error | null;
    beforeEach(() => {
        customer = undefined;
        identityError = null;
        mocks.useQuery.mockReset().mockImplementation(options => ({
            data: options.queryKey.at(-1) === 'customer' ? customer : undefined,
            isLoading: false,
            isPending: true,
            isPaused: false,
            isError: false,
            error: null,
        }));
    });
    const read = (
        currencyCode = 'CNY',
        storefrontContextResolved = true,
        options: Pick<
            Parameters<typeof useStorefrontCustomerData>[0],
            'activeRoute' | 'homepageCoupons'
        > = {},
    ) =>
        useStorefrontCustomerData({
            ...options,
            api: {} as ShopApi,
            market: { ...enabledMarkets[0], currencyCode },
            language: 'zh',
            vendureLanguageCode: 'zh_Hans',
            storefrontContextResolved,
            customerAuthenticated: Boolean(customer),
            customerIdentityQuery: {
                data: customer,
                isLoading: customer === undefined && !identityError,
                isPaused: false,
                isError: Boolean(identityError),
                error: identityError,
                refetch: vi.fn(),
            },
            configQuery: {
                isLoading: true,
                isPaused: false,
                isError: false,
                error: null,
                refetch: vi.fn(),
            },
        });

    it('waits for account resolution before querying claimable campaigns', () => {
        read('CNY', false);
        const options = mocks.useQuery.mock.calls.map(([input]) => input);
        expect(options.some(input => input.queryKey.at(-1) === 'customer')).toBe(false);
        expect(options.find(input => input.queryKey.includes('coupon-campaigns')).enabled).toBe(false);
        customer = null;
        mocks.useQuery.mockClear();
        read();
        const guestOptions = mocks.useQuery.mock.calls.map(([input]) => input);
        expect(guestOptions.find(input => input.queryKey.includes('coupon-campaigns')).enabled).toBe(false);
        expect(guestOptions.find(input => input.queryKey.at(-1) === 'cart').enabled).toBe(false);
        expect(guestOptions.find(input => input.queryKey.at(-1) === 'coupons').enabled).toBe(false);
    });

    it.each([undefined, null])(
        'loads homepage offers with identity %s without reading private coupons',
        identity => {
            customer = identity;
            const result = read('CNY', true, { activeRoute: 'home', homepageCoupons: true });
            const options = mocks.useQuery.mock.calls.map(([input]) => input);
            expect(options.find(input => input.queryKey.includes('coupon-campaigns')).enabled).toBe(true);
            expect(options.find(input => input.queryKey.at(-1) === 'coupons').enabled).toBe(false);
            expect(options.find(input => input.queryKey.includes('coupon-usage-records')).enabled).toBe(
                false,
            );
            expect(options.find(input => input.queryKey.at(-1) === 'cart').enabled).toBe(false);
            expect(result.couponCampaignsLoading).toBe(true);
        },
    );

    it('does not request homepage offers before store resolution or without a published coupon module', () => {
        for (const [resolved, homepageCoupons] of [
            [false, true],
            [true, false],
        ]) {
            mocks.useQuery.mockClear();
            read('CNY', resolved, { activeRoute: 'home', homepageCoupons });
            const options = mocks.useQuery.mock.calls.map(([input]) => input);
            expect(options.find(input => input.queryKey.includes('coupon-campaigns')).enabled).toBe(false);
        }
    });

    it('does not turn an identity failure into a public offer failure', () => {
        identityError = new Error('Account unavailable');
        const result = read('CNY', true, { activeRoute: 'home', homepageCoupons: true });
        expect(result.couponCampaignsError).toBe('');
        expect(result.couponCampaignsLoading).toBe(true);
    });

    it('isolates coupon cache keys when the account or settlement currency changes', () => {
        customer = { id: 'buyer-a' } as ActiveCustomer;
        const first = read();
        customer = { id: 'buyer-b' } as ActiveCustomer;
        const second = read();
        const currency = read('MYR');
        expect(first.customerCouponQueryKey).not.toEqual(second.customerCouponQueryKey);
        expect(second.customerCouponQueryKey).not.toEqual(currency.customerCouponQueryKey);
        expect(second.couponCampaignsQueryKey).toEqual(
            storefrontQueryKeys.couponCampaigns(
                storefrontQueryKeys.market({ ...enabledMarkets[0], currencyCode: 'CNY' }),
                'zh_Hans',
                'buyer-b',
            ),
        );
    });

    it('shows an account error instead of presenting an empty successful coupon list', () => {
        identityError = new Error('Account unavailable');
        mocks.useQuery.mockImplementation(options => ({
            data: undefined,
            isLoading: false,
            isPending: false,
            isPaused: false,
            isError: options.queryKey.at(-1) === 'customer',
            error: options.queryKey.at(-1) === 'customer' ? new Error('Account unavailable') : null,
        }));
        const result = read();
        expect(result.couponCampaignsLoading).toBe(false);
        expect(result.couponCampaignsError).toBe('操作暂时未能完成，请稍后重试。');
    });

    it('preserves identity while separately loading recent orders and leaves addresses disabled on account overview', () => {
        customer = {
            id: 'buyer-a',
            firstName: 'A',
            lastName: 'B',
            emailAddress: 'fixture@example.invalid',
            phoneNumber: null,
        };
        const result = read();
        expect(result.customer?.id).toBe('buyer-a');
        expect(result.customer?.orders).toBeUndefined();
        expect(result.customerDetailsLoadState).toBe('loading');
        const options = mocks.useQuery.mock.calls.map(([input]) => input);
        expect(options.find(input => input.queryKey.includes('customer-addresses')).enabled).toBe(false);
        expect(options.find(input => input.queryKey.includes('customer-recent-orders')).enabled).toBe(true);
        expect(options.find(input => input.queryKey.includes('coupon-usage-records'))?.enabled).not.toBe(
            true,
        );
    });
    it.each(['loading', 'error', 'missing'])(
        'opens the orders list without waiting for recent-order summaries: %s',
        state => {
            customer = { id: 'buyer-a' } as ActiveCustomer;
            mocks.useQuery.mockImplementation(queryOptions => ({
                data:
                    queryOptions.queryKey.includes('customer-recent-orders') && state === 'missing'
                        ? null
                        : undefined,
                isLoading: state === 'loading',
                isPending: state === 'loading',
                isPaused: false,
                isError: state === 'error',
                error: state === 'error' ? new Error('Summary unavailable') : null,
            }));
            const result = read('MYR', true, { activeRoute: 'orders' });
            expect(result.customer?.id).toBe('buyer-a');
            expect(result.customerDetailsLoadState).toBe('ready');
            const options = mocks.useQuery.mock.calls.map(([input]) => input);
            expect(options.find(input => input.queryKey.includes('customer-recent-orders')).enabled).toBe(
                true,
            );
        },
    );
});
