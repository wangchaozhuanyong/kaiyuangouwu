import { QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ShopApi } from './api';
import { languageCodeFor } from './i18n';
import { ReferralPage } from './pages/referral-page';
import { createStorefrontQueryClient, storefrontQueryKeys } from './query-client';
import { ReferralPageContext } from './storefront-page-contexts';
import { ActiveCustomer, MarketConfig, MyReferralOverview, ReferralProgram } from './types';

const market: MarketConfig = {
    code: 'referral-page-market',
    defaultLanguageCode: 'zh_Hans',
    currencyCode: 'CNY',
    countryCode: 'CN',
    locale: 'zh-CN',
    label: 'China',
};

const customer: ActiveCustomer = {
    id: 'customer-referral-page',
    firstName: '测试',
    lastName: '用户',
    emailAddress: 'referral-page@example.com',
    phoneNumber: null,
    addresses: [],
    orders: { items: [], totalItems: 0 },
};

const program: ReferralProgram = {
    channelId: 'channel-1',
    enabled: true,
    rewardRate: 10,
    releaseDelayDays: 7,
    minimumOrderAmount: 0,
    maxRewardPerOrder: null,
    allowBalanceSpend: true,
    attributionWindowDays: 30,
    defaultPosterTemplate: 'BRAND_MINIMAL',
    posterTemplates: ['BRAND_MINIMAL'],
};

const overview: MyReferralOverview = {
    enabled: true,
    rewardRate: 10,
    releaseDelayDays: 7,
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
            pendingBalance: 120,
            reservedBalance: 0,
        },
    ],
    rewardSummaries: [{ currencyCode: 'CNY', grossReward: 1000, clawedBackReward: 80 }],
    invitees: [],
    ledger: [],
};

function renderReferralPage(customOverview?: Partial<MyReferralOverview>): string {
    vi.stubGlobal('window', { location: { origin: 'https://storefront.example.com' } });
    const client = createStorefrontQueryClient();
    const languageCode = languageCodeFor('zh');
    client.setQueryData(
        storefrontQueryKeys.referralProgram(storefrontQueryKeys.market(market), languageCode),
        program,
    );
    client.setQueryData(
        storefrontQueryKeys.customerReferral(storefrontQueryKeys.market(market), languageCode, customer.id),
        { ...overview, ...customOverview },
    );

    const api = {
        referralProgram: vi.fn(),
        myReferralOverview: vi.fn(),
    } as unknown as ShopApi;

    return renderToStaticMarkup(
        <QueryClientProvider client={client}>
            <ReferralPageContext.Provider
                value={{
                    api,
                    customer,
                    market,
                    locale: market.locale,
                    language: 'zh',
                    storefrontName: '测试商城',
                    logoUrl: null,
                    onBack: vi.fn(),
                    onNotify: vi.fn(),
                    onLogin: vi.fn(),
                }}
            >
                <ReferralPage />
            </ReferralPageContext.Provider>
        </QueryClientProvider>,
    );
}

describe('referral page reward summary', () => {
    it('uses the concise referral headline and dynamic reward-rate copy', () => {
        const markup = renderReferralPage();

        expect(markup).toContain('邀请好友，获得奖励');
        expect(markup).toContain('好友成功消费，你可获得 10% 奖励用于消费抵扣。');
        expect(markup).not.toContain('好友邀请计划');
        expect(markup).not.toContain('退款会按比例扣回');
    });

    it('centers the four summary cards and moves reward guidance into an accessible info control', () => {
        const markup = renderReferralPage();

        expect(markup.match(/min-h-32 flex-col items-center justify-center/g)).toHaveLength(4);
        expect(markup).toContain('<details');
        expect(markup).toContain('aria-label="查看奖励说明"');
        expect(markup).toContain('默认 7 天后可用，可用于消费抵扣。');
        expect(markup).not.toContain('提现');
        expect(markup).not.toContain('人工提款');
    });

    it('places the invite count on the title row and removes the privacy subtitle', () => {
        const markup = renderReferralPage();

        expect(markup).toMatch(
            /邀请记录<\/h2><span class="text-xs font-bold tabular-nums text-slate-500">2<\/span>/,
        );
        expect(markup).not.toContain('只展示脱敏信息，保护好友隐私');
    });

    it('places the ledger count on the title row and removes the activity subtitle', () => {
        const markup = renderReferralPage();

        expect(markup).toMatch(
            /奖励流水<\/h2><span class="text-xs font-bold tabular-nums text-slate-500">0<\/span>/,
        );
        expect(markup).not.toContain('奖励、生效、退款扣回与消费抵扣全程留痕');
    });

    it('paginates invitees list with previous and next buttons', () => {
        const invitees = Array.from({ length: 15 }, (_, i) => ({
            id: `invitee-${i + 1}`,
            displayName: `好友${i + 1}`,
            boundAt: '2026-08-26T00:00:00.000Z',
            firstPaidOrderAt: i % 2 === 0 ? '2026-08-27T00:00:00.000Z' : null,
        }));

        const markup = renderReferralPage({
            invitedCount: 15,
            invitees,
        });

        expect(markup).toContain('好友1');
        expect(markup).toContain('好友10');
        expect(markup).not.toContain('好友11');
        expect(markup).toContain('共 15 条 · 第 1/2 页');
        expect(markup).toMatch(/disabled=""[^>]*aria-label="上一页"/);
        expect(markup).not.toMatch(/disabled=""[^>]*aria-label="下一页"/);
    });

    it('paginates reward activity ledger list with previous and next buttons', () => {
        const ledger = Array.from({ length: 12 }, (_, i) => ({
            id: `ledger-${i + 1}`,
            createdAt: '2026-08-26T00:00:00.000Z',
            eventType: 'REWARD_PENDING',
            currencyCode: 'CNY',
            availableDelta: 0,
            pendingDelta: (i + 1) * 10,
            reservedDelta: 0,
            availableAfter: 0,
            pendingAfter: (i + 1) * 10,
            reservedAfter: 0,
            actorType: 'SYSTEM',
        }));

        const markup = renderReferralPage({ ledger });

        expect(markup).toContain('共 12 条 · 第 1/2 页');
        expect(markup).toMatch(/disabled=""[^>]*aria-label="上一页"/);
        expect(markup).not.toMatch(/disabled=""[^>]*aria-label="下一页"/);
    });
});
