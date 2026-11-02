// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AccountPage } from './pages/account-page';
import { createStorefrontQueryClient, storefrontQueryKeys } from './query-client';
import { AccountPageContext } from './storefront-page-contexts';
import { StorefrontQueryFeedback } from './StorefrontQueryFeedback';

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
const scope = { marketCode: 'referral-fixture:CNY', languageCode: 'zh_Hans', includePrivate: true };
const market = {
    code: 'referral-fixture',
    currencyCode: 'CNY',
    locale: 'zh-CN',
    defaultLanguageCode: 'zh_Hans',
    countryCode: 'CN',
    label: 'Fixture',
};
const cleanups: Array<() => void> = [];
afterEach(async () => {
    await act(() => Promise.resolve(cleanups.splice(0).forEach(cleanup => cleanup())));
    localStorage.clear();
    vi.useRealTimers();
});
async function mount(enabled = true, signedIn = false, cached?: boolean) {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    const client = createStorefrontQueryClient();
    client.setDefaultOptions({ queries: { ...client.getDefaultOptions().queries, retry: false } });
    const key = storefrontQueryKeys.referralProgram(scope.marketCode, scope.languageCode);
    if (cached !== undefined) client.setQueryData(key, { enabled: cached }, { updatedAt: 0 });
    const api = {
        referralProgram: vi.fn().mockResolvedValue({ enabled }),
        myReferralOverview: vi
            .fn()
            .mockResolvedValue({ wallets: [{ currencyCode: 'CNY', availableBalance: 12345 }] }),
        customerOrderCounts: vi
            .fn()
            .mockResolvedValue({ pending: 0, shipping: 0, receiving: 0, completed: 0 }),
        afterSalesRequests: vi.fn().mockResolvedValue([]),
    };
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    cleanups.push(() => {
        root.unmount();
        client.clear();
        host.remove();
    });
    await act(() =>
        Promise.resolve(
            root.render(
                <QueryClientProvider client={client}>
                    <AccountPageContext.Provider
                        value={
                            {
                                api,
                                customer: signedIn
                                    ? {
                                          id: 'customer-1',
                                          emailAddress: 'fixture@example.test',
                                          firstName: 'Fixture',
                                          lastName: '',
                                          orders: { items: [] },
                                      }
                                    : null,
                                products: [],
                                market,
                                locale: 'zh-CN',
                                language: 'zh',
                                storefrontName: 'Fixture',
                                logoUrl: null,
                                favoriteProductCount: 0,
                                couponCount: 0,
                                onContentTarget: vi.fn(),
                                onLogout: vi.fn(),
                            } as never
                        }
                    >
                        <AccountPage />
                    </AccountPageContext.Provider>
                    <StorefrontQueryFeedback scope={scope} language="zh" />
                </QueryClientProvider>,
            ),
        ),
    );
    await act(async () => vi.advanceTimersByTimeAsync(250));
    return { api, client, host, key };
}

describe('shared referral reads and background failures', () => {
    it.each([true, false])('revalidates stale root-query settings: enabled=%s', async enabled => {
        const { api, client, key } = await mount(enabled, false, !enabled);
        expect(api.referralProgram).toHaveBeenCalledTimes(1);
        expect(client.getQueryData(key)).toEqual({ enabled });
    });
    it('does not restore or write a separate legacy localStorage configuration', async () => {
        const legacy = JSON.stringify({ enabled: true });
        localStorage.setItem('storefront:referral-program:referral-fixture', legacy);
        const { client, key } = await mount(false);
        expect(client.getQueryData(key)).toEqual({ enabled: false });
        expect(localStorage.getItem('storefront:referral-program:referral-fixture')).toBe(legacy);
    });
    it('retains a known balance and only retries reads after a background failure', async () => {
        const { api, client, host } = await mount(true, true);
        const balance = () => host.querySelector('.account-identity-promotion-balance')?.textContent;
        expect(balance()).toContain('123.45');
        api.myReferralOverview.mockRejectedValue(new Error('Synthetic network failure'));
        const key = storefrontQueryKeys.customerReferral(scope.marketCode, scope.languageCode, 'customer-1');
        await act(async () => {
            await client.refetchQueries({ queryKey: key, exact: true }, { cancelRefetch: false });
        });
        await act(async () => vi.advanceTimersByTimeAsync(250));
        expect(balance()).toContain('123.45');
        expect(balance()).not.toContain('暂不可用');
        expect(host.textContent).toContain('更新失败，已保留上次内容');
        const reads = api.myReferralOverview.mock.calls.length;
        api.myReferralOverview.mockResolvedValue({
            wallets: [{ currencyCode: 'CNY', availableBalance: 23456 }],
        });
        const retry = host.querySelector<HTMLButtonElement>('.storefront-query-feedback button');
        expect(retry).not.toBeNull();
        if (!retry) throw new Error('Missing retry button');
        await act(() => Promise.resolve(retry.click()));
        await act(async () => vi.advanceTimersByTimeAsync(250));
        expect(api.myReferralOverview).toHaveBeenCalledTimes(reads + 1);
        expect(balance()).toContain('234.56');
    });
});
