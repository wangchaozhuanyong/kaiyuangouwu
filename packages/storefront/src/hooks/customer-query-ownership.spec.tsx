// organize-imports-ignore -- Preserve the ESLint type-import groups.
// @vitest-environment jsdom
import type { ShopApi } from '../api';
import type { RouteName } from '../storefront-router';
import type { CustomerIdentity } from '../types';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { enabledMarkets } from '../i18n';
import { storefrontQueryKeys } from '../query-client';

import { useStorefrontCustomerData } from './useStorefrontCustomerData';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const cleanups: Array<() => void> = [];
afterEach(() => {
    for (const clean of cleanups.splice(0)) clean();
});
const customer = (id = 'buyer-a'): CustomerIdentity => ({
    id,
    firstName: 'A',
    lastName: 'B',
    emailAddress: 'fixture@example.invalid',
    phoneNumber: null,
    avatar: { id: 'avatar', preview: '/assets/avatar.png' },
});

async function setup() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const api = {
        customerIdentity: vi.fn().mockResolvedValue(customer()),
        cart: vi.fn().mockResolvedValue(null),
        customerAddresses: vi.fn().mockResolvedValue([]),
        customerRecentOrders: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
        activeCouponCampaigns: vi.fn().mockResolvedValue([]),
        myAvailableCoupons: vi.fn().mockResolvedValue([]),
        myCouponUsageRecordsPage: vi.fn().mockResolvedValue({ items: [], totalItems: 0 }),
    };
    let route: RouteName = 'home';
    let result!: ReturnType<typeof useStorefrontCustomerData>;
    const market = enabledMarkets[0];
    const identityKey = storefrontQueryKeys.customer(storefrontQueryKeys.market(market), 'zh_Hans');
    function Harness() {
        const identity = useQuery({
            queryKey: identityKey,
            queryFn: () => api.customerIdentity(),
            staleTime: 60_000,
        });
        result = useStorefrontCustomerData({
            api: api as unknown as ShopApi,
            market,
            language: 'zh',
            vendureLanguageCode: 'zh_Hans',
            storefrontContextResolved: true,
            customerAuthenticated: Boolean(identity.data),
            customerIdentityQuery: identity,
            activeRoute: route,
            configQuery: { isLoading: false, isPaused: false, isError: false, error: null, refetch: vi.fn() },
        });
        return <span data-customer={result.customer?.id}>{result.customer?.firstName}</span>;
    }
    const container = document.createElement('div');
    const root = createRoot(container);
    const render = async () => {
        await act(async () => {
            root.render(
                <QueryClientProvider client={client}>
                    <Harness />
                </QueryClientProvider>,
            );
            await new Promise(resolve => setTimeout(resolve, 20));
        });
    };
    cleanups.push(() => {
        act(() => root.unmount());
        client.clear();
    });
    await render();
    return {
        api,
        client,
        container,
        identityKey,
        get result() {
            return result;
        },
        go: async (next: RouteName) => {
            route = next;
            await render();
        },
        render,
    };
}

describe('real customer query ownership', () => {
    it('reads identity once and starts addresses/orders/coupons only for pages which need them', async () => {
        const h = await setup();
        expect(h.api.customerIdentity).toHaveBeenCalledTimes(1);
        expect(h.api.customerAddresses).not.toHaveBeenCalled();
        expect(h.api.customerRecentOrders).not.toHaveBeenCalled();
        expect(h.api.activeCouponCampaigns).not.toHaveBeenCalled();
        await h.go('account');
        expect(h.api.customerRecentOrders).toHaveBeenCalledTimes(1);
        expect(h.api.customerAddresses).not.toHaveBeenCalled();
        await h.go('account-security');
        await h.go('home');
        await h.go('account');
        expect(h.api.customerIdentity).toHaveBeenCalledTimes(1);
        expect(h.api.customerRecentOrders).toHaveBeenCalledTimes(1);
        expect(h.api.customerAddresses).toHaveBeenCalledTimes(1);
        expect(
            h.client.getQueryCache().find({ queryKey: h.identityKey, exact: true })?.getObserversCount(),
        ).toBe(1);
    });
    it('keeps the same identity during delayed detail reads and same-scope identity refresh', async () => {
        const h = await setup();
        const node = h.container.firstElementChild;
        let resolveOrders!: (value: { items: []; totalItems: number }) => void;
        h.api.customerRecentOrders.mockImplementationOnce(
            () =>
                new Promise(resolve => {
                    resolveOrders = resolve;
                }),
        );
        await h.go('account');
        expect(h.result.customer?.id).toBe('buyer-a');
        expect(h.result.customerDetailsLoadState).toBe('loading');
        expect(h.container.firstElementChild).toBe(node);
        await act(async () => {
            resolveOrders({ items: [], totalItems: 0 });
            await new Promise(resolve => setTimeout(resolve, 20));
        });
        let resolveIdentity!: (value: CustomerIdentity) => void;
        h.api.customerIdentity.mockImplementationOnce(
            () =>
                new Promise(resolve => {
                    resolveIdentity = resolve;
                }),
        );
        let refresh!: Promise<void>;
        await act(async () => {
            refresh = h.client.invalidateQueries({ queryKey: h.identityKey });
            await Promise.resolve();
        });
        expect(h.result.customer?.id).toBe('buyer-a');
        expect(h.container.firstElementChild).toBe(node);
        await act(async () => {
            resolveIdentity(customer());
            await refresh;
        });
    });
    it('retains identity on a history failure and isolates the next customer from cached details', async () => {
        const h = await setup();
        h.api.customerRecentOrders.mockRejectedValueOnce(new Error('history unavailable'));
        await h.go('account');
        expect(h.result.customer?.id).toBe('buyer-a');
        expect(h.result.customerDetailsLoadState).toBe('error');
        await act(async () => {
            h.client.setQueryData(h.identityKey, null);
            await new Promise(resolve => setTimeout(resolve, 20));
        });
        expect(h.result.customer).toBeNull();
        await act(async () => {
            h.client.setQueryData(h.identityKey, customer('buyer-b'));
            await new Promise(resolve => setTimeout(resolve, 20));
        });
        expect(h.result.customer?.id).toBe('buyer-b');
        expect(h.result.customerRecentOrdersQueryKey.at(-1)).toBe('buyer-b');
        expect(h.api.customerRecentOrders).toHaveBeenCalledTimes(2);
    });
});
