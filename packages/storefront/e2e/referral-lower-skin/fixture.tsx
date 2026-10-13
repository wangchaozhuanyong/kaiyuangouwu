// organize-imports-ignore -- Keep the production style entry before the lazy account-route styles.
import type { ShopApi } from '../../src/api';
import type {
    ActiveCustomer,
    MarketConfig,
    MyReferralOverview,
    ReferralProgram,
    StorefrontLanguage,
} from '../../src/types';
import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import {
    resolveStorefrontSemanticPalette,
    semanticPaletteCssVariables,
    storefrontSkinCssVariables,
} from '../../../storefront-content-plugin/src/shared/storefront-semantic-palette';
import { normalizeStorefrontVisualPreset } from '../../../storefront-content-plugin/src/visual-presets';
import { DesktopLayoutContext, useDesktopViewport } from '../../src/desktop-layout';
import { languageCodeFor } from '../../src/i18n';
import { ReferralPage } from '../../src/pages/referral-page';
import { createStorefrontQueryClient, storefrontQueryKeys } from '../../src/query-client';
import { ReferralPageContext } from '../../src/storefront-page-contexts';
import '../../src/storefront-styles';
import '../../src/commerce-styles';
import '../../src/styles/account-catalog-surfaces.css';
import '../../src/styles/account-identity.css';
import { applyStorefrontVisualPreset } from '../../src/use-storefront-visual-preset';

// Entirely synthetic, in-memory reads. No ShopApi instance, HTTP API or account writes.
const params = new URLSearchParams(location.search);
const language: StorefrontLanguage = params.get('lang') === 'en' ? 'en' : 'zh';
const preset = normalizeStorefrontVisualPreset(params.get('skin'));
const empty = params.get('state') === 'empty';
const count = empty ? 0 : 12;
const currencyCode = params.get('currency') === 'MYR' ? 'MYR' : 'CNY';
const palette = resolveStorefrontSemanticPalette(preset);
applyStorefrontVisualPreset(document.documentElement, preset);
document.documentElement.lang = language;
document.documentElement.dataset.fixtureSource = 'synthetic-referral-lower-skin';
for (const [name, value] of Object.entries({
    ...semanticPaletteCssVariables(palette),
    ...storefrontSkinCssVariables(preset, palette),
})) {
    document.documentElement.style.setProperty(name, value);
}

const market: MarketConfig = {
    code: 'local-referral-skin-fixture',
    defaultLanguageCode: languageCodeFor(language),
    currencyCode,
    countryCode: currencyCode === 'MYR' ? 'MY' : 'CN',
    locale: language === 'zh' ? 'zh-CN' : currencyCode === 'MYR' ? 'en-MY' : 'en-US',
    label: 'Synthetic referral acceptance',
};
const customer: ActiveCustomer = {
    id: 'synthetic-customer',
    firstName: 'Synthetic',
    lastName: 'Customer',
    emailAddress: 'synthetic@example.invalid',
    phoneNumber: null,
    addresses: [],
    orders: { items: [], totalItems: 0 },
};
const program: ReferralProgram = {
    channelId: 'synthetic-referral-channel',
    enabled: true,
    rewardRate: 10,
    releaseDelayDays: 7,
    minimumOrderAmount: 0,
    maxRewardPerOrder: null,
    allowBalanceSpend: true,
    attributionWindowDays: 30,
    defaultPosterTemplate: 'BRAND_MINIMAL',
    posterTemplates: [],
};
const overview: MyReferralOverview = {
    enabled: true,
    rewardRate: 10,
    releaseDelayDays: 7,
    inviteCode: 'LOCAL888',
    invitedCount: count,
    purchasedInviteeCount: count / 2,
    wallets: [
        {
            id: 'synthetic-wallet',
            createdAt: '2026-10-01T00:00:00.000Z',
            updatedAt: '2026-10-13T00:00:00.000Z',
            currencyCode,
            availableBalance: empty ? 0 : 128880,
            pendingBalance: empty ? 0 : 2990,
            reservedBalance: 0,
        },
    ],
    rewardSummaries: [
        {
            currencyCode,
            grossReward: empty ? 0 : 132670,
            clawedBackReward: empty ? 0 : 800,
        },
    ],
    invitees: Array.from({ length: count }, (_, index) => ({
        id: `synthetic-invitee-${index + 1}`,
        displayName: language === 'zh' ? `示例好友 ${index + 1}` : `Sample friend ${index + 1}`,
        boundAt: '2026-10-10T08:00:00.000Z',
        firstPaidOrderAt: index % 2 ? null : '2026-10-11T08:00:00.000Z',
    })),
    ledger: Array.from({ length: count }, (_, index) => ({
        id: `synthetic-ledger-${index + 1}`,
        createdAt: '2026-10-12T08:00:00.000Z',
        eventType: index % 3 === 0 ? 'REFUND_CLAWBACK' : 'REWARD_AVAILABLE',
        currencyCode,
        availableDelta: index % 3 === 0 ? -200 : 1250,
        pendingDelta: 0,
        reservedDelta: 0,
        availableAfter: 128880,
        pendingAfter: 2990,
        reservedAfter: 0,
        actorType: 'SYSTEM',
        note: 'Synthetic browser acceptance row',
    })),
};
const client = createStorefrontQueryClient();
const scope = storefrontQueryKeys.market(market);
const languageCode = languageCodeFor(language);
client.setQueryData(storefrontQueryKeys.referralProgram(scope, languageCode), program);
client.setQueryData(storefrontQueryKeys.customerReferral(scope, languageCode, customer.id), overview);
const api = {
    referralProgram: () => Promise.resolve(program),
    myReferralOverview: () => Promise.resolve(overview),
} as unknown as ShopApi;

function Fixture() {
    const desktop = useDesktopViewport();
    const [message, setMessage] = useState('');
    return (
        <QueryClientProvider client={client}>
            <DesktopLayoutContext.Provider value={desktop}>
                <div className={`storefront-app${desktop ? ' desktop-store-layout' : ''}`}>
                    <div id="storefront-content">
                        <ReferralPageContext.Provider
                            value={{
                                api,
                                customer,
                                market,
                                locale: market.locale,
                                language,
                                storefrontName: language === 'zh' ? '本地验收商城' : 'Local sample store',
                                logoUrl: null,
                                onBack: () => setMessage('Local fixture: back'),
                                onNotify: setMessage,
                                onLogin: () => setMessage('Local fixture: sign in'),
                            }}
                        >
                            <ReferralPage />
                        </ReferralPageContext.Provider>
                    </div>
                    <output role="status">{message}</output>
                </div>
            </DesktopLayoutContext.Provider>
        </QueryClientProvider>
    );
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Local referral skin fixture root is missing');
createRoot(rootElement).render(<Fixture />);
