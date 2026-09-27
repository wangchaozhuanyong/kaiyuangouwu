import { QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ShopApi } from './api';
import { DesktopLayoutContext } from './desktop-layout';
import { languageCodeFor } from './i18n';
import { AccountPage } from './pages/account-page';
import { createStorefrontQueryClient, storefrontQueryKeys } from './query-client';
import { AccountPageContext } from './storefront-page-contexts';
import { ActiveCustomer, MarketConfig, MyReferralOverview, ReferralProgram } from './types';

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));

const market: MarketConfig = {
    code: 'referral-visibility-market',
    defaultLanguageCode: 'zh_Hans',
    currencyCode: 'CNY',
    countryCode: 'CN',
    locale: 'zh-CN',
    label: 'China',
};

const customer: ActiveCustomer = {
    id: 'customer-referral-1',
    firstName: '测试',
    lastName: '用户',
    emailAddress: 'referral@example.com',
    phoneNumber: null,
    addresses: [],
    orders: { items: [], totalItems: 0 },
};

const overview: MyReferralOverview = {
    enabled: true,
    rewardRate: 10,
    releaseDelayDays: 0,
    inviteCode: 'INVITE88',
    invitedCount: 2,
    purchasedInviteeCount: 1,
    wallets: [
        {
            id: 'wallet-1',
            createdAt: '2026-08-26T00:00:00.000Z',
            updatedAt: '2026-08-26T00:00:00.000Z',
            currencyCode: 'CNY',
            availableBalance: 880,
            pendingBalance: 0,
            reservedBalance: 0,
        },
    ],
    rewardSummaries: [],
    invitees: [],
    ledger: [],
};

function renderAccount(
    referralEnabled: boolean,
    options: {
        desktop?: boolean;
        prepareClient?: (client: ReturnType<typeof createStorefrontQueryClient>) => void;
    } = {},
): string {
    const client = createStorefrontQueryClient();
    const languageCode = languageCodeFor('zh');
    const program: ReferralProgram = {
        channelId: 'channel-1',
        enabled: referralEnabled,
        rewardRate: 10,
        releaseDelayDays: 0,
        minimumOrderAmount: 0,
        maxRewardPerOrder: null,
        allowBalanceSpend: true,
        attributionWindowDays: 30,
        defaultPosterTemplate: 'BRAND_MINIMAL',
        posterTemplates: ['BRAND_MINIMAL', 'BENEFIT_RED_GOLD', 'PRODUCT_STORY', 'PREMIUM_DARK'],
    };
    client.setQueryData(
        storefrontQueryKeys.referralProgram(storefrontQueryKeys.market(market), languageCode),
        program,
    );
    client.setQueryData(
        storefrontQueryKeys.customerOrderCounts(
            storefrontQueryKeys.market(market),
            languageCode,
            customer.id,
        ),
        {
            pending: 0,
            shipping: 0,
            receiving: 0,
            completed: 0,
        },
    );
    client.setQueryData(
        storefrontQueryKeys.afterSalesRequests(storefrontQueryKeys.market(market), languageCode, customer.id),
        [],
    );
    if (referralEnabled) {
        client.setQueryData(
            storefrontQueryKeys.customerReferral(
                storefrontQueryKeys.market(market),
                languageCode,
                customer.id,
            ),
            overview,
        );
    }

    options.prepareClient?.(client);
    const api = {
        referralProgram: vi.fn(),
        myReferralOverview: vi.fn(),
        customerOrderCounts: vi.fn(),
        afterSalesRequests: vi.fn(),
    } as unknown as ShopApi;

    return renderToStaticMarkup(
        <QueryClientProvider client={client}>
            <AccountPageContext.Provider
                value={{
                    api,
                    customer,
                    products: [],
                    market,
                    locale: market.locale,
                    language: 'zh',
                    storefrontName: '测试商城',
                    logoUrl: null,
                    favoriteProductCount: 0,
                    couponCount: 0,
                    displayCurrencyCode: market.currencyCode,
                    availableCurrencyCodes: [market.currencyCode],
                    currencyLoading: false,
                    onToggleLanguage: vi.fn(),
                    onCurrencyChange: vi.fn(),
                    onContentTarget: vi.fn(),
                    onLogout: vi.fn(),
                }}
            >
                <DesktopLayoutContext.Provider value={options.desktop ?? false}>
                    <AccountPage />
                </DesktopLayoutContext.Provider>
            </AccountPageContext.Provider>
        </QueryClientProvider>,
    );
}

describe('account referral visibility', () => {
    it('keeps three shortcuts and a real referral balance when enabled', () => {
        const markup = renderAccount(true);

        expect(markup).toContain('account-mobile-header');
        expect(markup).toContain('locale-preferences-trigger');
        expect(markup).toContain('我的订单中心');
        expect(markup).toContain('返利余额');
        expect(markup).toContain('¥8.8');
        expect(markup).toContain('账户快捷入口');
        expect(markup).toContain('我的收藏');
        expect(markup).toContain('优惠券');
        expect(markup).toContain('推广中心');
        expect(markup).not.toContain('data-page-pending="query"');
    });

    it('keeps the shared mobile header off the desktop account layout', () => {
        expect(renderAccount(true, { desktop: true })).not.toContain('account-mobile-header');
    });

    it('keeps favorites and marks referral unavailable when disabled', () => {
        const markup = renderAccount(false);

        expect(markup).toContain('我的收藏');
        expect(markup).not.toContain('返利余额');
        expect(markup).toContain('暂未开放');
    });

    it('uses the independent identity card and masks the account address', () => {
        const markup = renderAccount(true);
        expect(markup).toContain('account-identity-card');
        expect(markup).toContain('欢迎回来');
        expect(markup).toContain('re***@example.com');
        expect(markup).not.toContain(customer.emailAddress);
        expect(markup).not.toContain('account-hero-art');
        expect(markup).not.toContain('has-custom-background');
    });

    it.each([false, true])('waits for initial member counts in desktop=%s', desktop => {
        const markup = renderAccount(true, {
            desktop,
            prepareClient: client =>
                client.removeQueries({
                    queryKey: storefrontQueryKeys.customerOrderCounts(
                        storefrontQueryKeys.market(market),
                        languageCodeFor('zh'),
                        customer.id,
                    ),
                }),
        });
        expect(markup).toContain('data-page-pending="query"');
    });

    it('does not gate cached member content during a background refresh', () => {
        const markup = renderAccount(true, {
            prepareClient: client => void client.invalidateQueries(),
        });
        expect(markup).not.toContain('data-page-pending="query"');
    });
});
