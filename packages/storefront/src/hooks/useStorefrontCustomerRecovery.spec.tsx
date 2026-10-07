// @vitest-environment jsdom
import { notifyManager, QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { enabledMarkets } from '../i18n';
import { storefrontQueryKeys } from '../query-client';
import { HomeRoutePage } from '../route-pages/catalog-route-pages';
import { type ActiveCustomer, type StorefrontConfig } from '../types';

import { useStorefrontBootstrap } from './useStorefrontBootstrap';
import { useStorefrontCustomerData } from './useStorefrontCustomerData';

const mocks = vi.hoisted(() => {
    const runtime: Record<string, unknown> = {};
    return {
        config: vi.fn(),
        activeCustomer: vi.fn(),
        activeCouponCampaigns: vi.fn(),
        runtime,
    };
});
vi.mock('../api', () => ({
    ShopApi: class {
        enableCartCommands = () => undefined;
        activeCustomer = mocks.activeCustomer;
        activeCouponCampaigns = mocks.activeCouponCampaigns;
        cart = () => Promise.resolve(null);
        myAvailableCoupons = () => Promise.resolve([]);
        myCouponUsageRecordsPage = () => Promise.resolve({ items: [], totalItems: 0 });
    },
}));
vi.mock('../use-storefront-visual-preset', () => ({
    useStorefrontVisualPreset: () => ({ presetId: 'classic' }),
}));
vi.mock('./useStorefrontDocument', () => ({ useStorefrontBrandColors: () => undefined }));
vi.mock('./useStorefrontPublicData', () => ({
    useStorefrontPublicData: (context: {
        market: { code: string; currencyCode: string };
        vendureLanguageCode: string;
    }) => ({
        configQuery: useQuery({
            queryKey: [
                ...storefrontQueryKeys.config(
                    storefrontQueryKeys.market(context.market),
                    context.vendureLanguageCode,
                ),
                'public',
            ],
            queryFn: mocks.config,
            staleTime: Infinity,
        }),
        productsQuery: { data: [], isPending: false },
        contentQuery: { data: { blocks: [] }, isPending: false },
        collectionsQuery: { data: [] },
    }),
}));
vi.mock('../route-pages/shared', () => ({
    useRouteRuntime: () => mocks.runtime,
    registerRoutePreload: () => undefined,
}));
vi.mock('../desktop-layout', () => ({ useDesktopLayout: () => false }));
vi.mock('@tanstack/react-router', async () => {
    const { HomePageContext } = await import('../storefront-page-contexts');
    return {
        lazyRouteComponent: () =>
            function HomeProbe() {
                const context = HomePageContext.useValue();
                return (
                    <>
                        <p role="alert">{context.couponCampaignsError}</p>
                        <button onClick={context.onCouponCampaignsRetry}>重试优惠</button>
                    </>
                );
            },
    };
});
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const config: StorefrontConfig = {
    code: 'my-malaysia',
    defaultLanguageCode: 'en',
    defaultCurrencyCode: 'MYR',
    availableCountries: [{ code: 'MY', name: 'Malaysia' }],
    customFields: { storefrontNameZh: '测试店铺', storefrontNameEn: 'Test store' },
};
const customer = { id: 'synthetic-customer' } as ActiveCustomer;

describe('account and home coupon dependency recovery', () => {
    let root: ReturnType<typeof createRoot>;
    let host: HTMLDivElement;
    let client: QueryClient;
    let account: ReturnType<typeof useStorefrontCustomerData>;
    let bootstrap: ReturnType<typeof useStorefrontBootstrap>;
    const eventually = async (check: () => void) => {
        await vi.waitFor(async () => {
            await act(async () => {
                await new Promise(resolve => setTimeout(resolve, 0));
            });
            check();
        });
    };
    function Harness() {
        bootstrap = useStorefrontBootstrap();
        account = useStorefrontCustomerData({
            ...bootstrap.queryContext,
            configQuery: bootstrap.configQuery,
        });
        mocks.runtime = {
            ...bootstrap,
            ...account,
            retryAccount: account.retryCustomer,
        };
        return <HomeRoutePage />;
    }
    beforeEach(() => {
        localStorage.clear();
        notifyManager.setNotifyFunction(callback => act(callback));
        vi.spyOn(navigator, 'language', 'get').mockReturnValue('zh-CN');
        mocks.config.mockReset().mockResolvedValue(config);
        mocks.activeCustomer.mockReset().mockResolvedValue(customer);
        mocks.activeCouponCampaigns.mockReset().mockResolvedValue([]);
        client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
        host = document.createElement('div');
        document.body.append(host);
        root = createRoot(host);
    });
    afterEach(() => {
        act(() => root.unmount());
        client.clear();
        host.remove();
        notifyManager.setNotifyFunction(callback => callback());
        vi.restoreAllMocks();
    });
    const clickRetry = () => {
        const button = host.querySelector('button');
        if (!button) throw new Error('Coupon retry button is missing');
        button.click();
    };
    const render = () =>
        act(() =>
            root.render(
                <QueryClientProvider client={client}>
                    <Harness />
                </QueryClientProvider>,
            ),
        );

    it('exposes a failed required configuration and retries it before resolving the account', async () => {
        mocks.config.mockRejectedValueOnce(new Error('Synthetic config failure'));
        render();
        await eventually(() => expect(bootstrap.configQuery.isError).toBe(true));
        expect(bootstrap.storefrontContextResolved).toBe(false);
        expect(account.customer).toBeNull();
        expect(mocks.activeCustomer).not.toHaveBeenCalled();
        expect(account.customerLoadState).toBe('error');
        expect(account.customerLoadError).toBe('操作暂时未能完成，请稍后重试。');
        await act(async () => {
            await account.retryCustomer();
        });
        await eventually(() => expect(account.customerLoadState).toBe('ready'));
        expect(account.customer?.id).toBe(customer.id);
        expect(bootstrap.storefrontContextResolved).toBe(true);
    });

    it('retries the failed account from the coupon action, then loads coupons under that customer key', async () => {
        mocks.activeCustomer.mockRejectedValueOnce(new Error('Synthetic account failure'));
        render();
        await eventually(() => expect(account.customerQuery.isError).toBe(true));
        expect(mocks.activeCouponCampaigns).not.toHaveBeenCalled();
        expect(host.querySelector('[role="alert"]')?.textContent).toBe('操作暂时未能完成，请稍后重试。');
        act(() => clickRetry());
        await eventually(() => expect(account.couponCampaignsError).toBe(''));
        await eventually(() => expect(mocks.activeCouponCampaigns).toHaveBeenCalledTimes(1));
        expect(mocks.activeCustomer).toHaveBeenCalledTimes(2);
        expect(account.couponCampaignsQueryKey).toContain(customer.id);
        expect(account.activeCoupons).toEqual([]);
    });

    it('deduplicates repeated recovery clicks while the account read is pending', async () => {
        mocks.activeCustomer.mockRejectedValueOnce(new Error('Synthetic account failure'));
        render();
        await eventually(() => expect(account.customerQuery.isError).toBe(true));
        let resolveAccount!: (value: ActiveCustomer) => void;
        mocks.activeCustomer.mockImplementationOnce(
            () =>
                new Promise<ActiveCustomer>(resolve => {
                    resolveAccount = resolve;
                }),
        );
        act(() => {
            clickRetry();
            clickRetry();
        });
        expect(mocks.activeCustomer).toHaveBeenCalledTimes(2);
        expect(mocks.activeCouponCampaigns).not.toHaveBeenCalled();
        await act(async () => {
            resolveAccount(customer);
            await Promise.resolve();
        });
        await eventually(() => expect(account.couponCampaignsError).toBe(''));
        await eventually(() => expect(mocks.activeCouponCampaigns).toHaveBeenCalledTimes(1));
    });

    it('does not accept cached customer identity until store configuration is resolved', async () => {
        mocks.config.mockRejectedValue(new Error('Synthetic config failure'));
        client.setQueryData(
            storefrontQueryKeys.customer(storefrontQueryKeys.market(enabledMarkets[0]), 'zh_Hans'),
            customer,
        );
        render();
        await eventually(() => expect(bootstrap.configQuery.isError).toBe(true));
        expect(account.customer).toBeNull();
        expect(account.customerLoadState).toBe('error');
        expect(mocks.activeCustomer).not.toHaveBeenCalled();
        expect(mocks.activeCouponCampaigns).not.toHaveBeenCalled();
    });

    it('retries only coupons when the account is already ready', async () => {
        mocks.activeCouponCampaigns.mockRejectedValueOnce(new Error('Synthetic coupon failure'));
        render();
        await eventually(() => expect(account.couponCampaignsQuery.isError).toBe(true));
        const accountReads = mocks.activeCustomer.mock.calls.length;
        act(() => clickRetry());
        await eventually(() => expect(account.couponCampaignsError).toBe(''));
        expect(mocks.activeCouponCampaigns).toHaveBeenCalledTimes(2);
        expect(mocks.activeCustomer).toHaveBeenCalledTimes(accountReads);
    });

    it('keeps a resolved account and coupons usable when configuration refresh fails', async () => {
        render();
        await eventually(() => expect(account.customerLoadState).toBe('ready'));
        await eventually(() => expect(account.couponCampaignsQuery.data).toEqual([]));
        mocks.config.mockRejectedValue(new Error('Synthetic refresh failure'));
        await act(async () => {
            await bootstrap.configQuery.refetch({ cancelRefetch: false });
        });
        await eventually(() => expect(bootstrap.configQuery.isError).toBe(true));
        expect(bootstrap.storefrontContextResolved).toBe(true);
        expect(account.customerLoadState).toBe('ready');
        expect(account.customer?.id).toBe(customer.id);
        expect(account.couponCampaignsError).toBe('');
    });

    it('treats a successfully resolved anonymous session as ready, without retrying or fetching private coupons', async () => {
        mocks.activeCustomer.mockResolvedValue(null);
        render();
        await eventually(() => expect(account.customerLoadState).toBe('ready'));
        expect(account.customer).toBeNull();
        expect(account.couponCampaignsError).toBe('');
        expect(mocks.activeCouponCampaigns).not.toHaveBeenCalled();
    });
});
