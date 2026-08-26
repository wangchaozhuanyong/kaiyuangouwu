import { QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ShopApi } from './api';
import { languageCodeFor } from './i18n';
import { AccountPage } from './pages/account-page';
import { createStorefrontQueryClient, storefrontQueryKeys } from './query-client';
import { StorefrontContext } from './StorefrontContext';
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

function renderAccount(referralEnabled: boolean): string {
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
    client.setQueryData(storefrontQueryKeys.referralProgram(market.code, languageCode), program);
    client.setQueryData(storefrontQueryKeys.customerOrderCounts(market.code, languageCode, customer.id), {
        pending: 0,
        shipping: 0,
        receiving: 0,
    });
    client.setQueryData(storefrontQueryKeys.afterSalesRequests(market.code, languageCode, customer.id), []);
    if (referralEnabled) {
        client.setQueryData(
            storefrontQueryKeys.customerReferral(market.code, languageCode, customer.id),
            overview,
        );
    }

    const api = {
        referralProgram: vi.fn(),
        myReferralOverview: vi.fn(),
        customerOrderCounts: vi.fn(),
        afterSalesRequests: vi.fn(),
    } as unknown as ShopApi;

    return renderToStaticMarkup(
        <QueryClientProvider client={client}>
            <StorefrontContext.Provider
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
                    announcementCount: 0,
                    couponCount: 0,
                    addingVariantId: null,
                    onContentTarget: vi.fn(),
                    onAdd: vi.fn(),
                    onLogout: vi.fn(),
                }}
            >
                <AccountPage />
            </StorefrontContext.Provider>
        </QueryClientProvider>,
    );
}

describe('account referral visibility', () => {
    it('changes the account asset row to four entries when referral is enabled', () => {
        const markup = renderAccount(true);

        expect(markup).toContain('grid-cols-4');
        expect(markup).toContain('邀请返利');
        expect(markup).toContain('¥8.8');
    });

    it('keeps three entries and hides referral when the program is disabled', () => {
        const markup = renderAccount(false);

        expect(markup).toContain('grid-cols-3');
        expect(markup).not.toContain('邀请返利');
    });
});
