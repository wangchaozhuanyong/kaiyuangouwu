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
    const read = (currencyCode = 'CNY', storefrontContextResolved = true) =>
        useStorefrontCustomerData({
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
});
