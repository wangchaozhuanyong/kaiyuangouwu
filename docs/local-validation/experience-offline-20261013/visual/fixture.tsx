// organize-imports-ignore
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';

import { fixtureData } from '../../../../packages/storefront/e2e/visual-presets/fixtures.mjs';
import { DesktopLayoutContext, useDesktopViewport } from '../../../../packages/storefront/src/desktop-layout';
import {
    trackFixedBottomBars,
    trackFixedBottomViewport,
} from '../../../../packages/storefront/src/fixed-bottom-viewport';
import { OverlayHost } from '../../../../packages/storefront/src/overlay-host';
import { AiImageStudioPage } from '../../../../packages/storefront/src/pages/ai-image-studio-page';
import { HomePage } from '../../../../packages/storefront/src/pages/home-page';
import { ReferralPage } from '../../../../packages/storefront/src/pages/referral-page';
import { SupportContent } from '../../../../packages/storefront/src/pages/support-page';
import {
    HomePageContext,
    ReferralPageContext,
} from '../../../../packages/storefront/src/storefront-page-contexts';
import { Subpage } from '../../../../packages/storefront/src/storefront-ui/page-shell';
import { StorefrontContext } from '../../../../packages/storefront/src/StorefrontContext';
import {
    resolveStorefrontSemanticPalette,
    semanticPaletteCssVariables,
    storefrontSkinCssVariables,
} from '../../../../packages/storefront-content-plugin/src/shared/storefront-semantic-palette';
import '../../../../packages/storefront/src/styles.css';
import '../../../../packages/storefront/src/styles/desktop-home.css';
import '../../../../packages/storefront/src/styles/desktop-layout.css';
import '../../../../packages/storefront/src/styles/desktop-pages.css';
import '../../../../packages/storefront/src/styles/subpage-content.css';
import '../../../../packages/storefront/src/styles/visual-presets.css';

// Actual production components; all business data is synthetic and no writes are offered.
const params = new URLSearchParams(location.search);
const language = params.get('lang') === 'en' ? 'en' : 'zh';
const preset = params.get('skin') === 'neo-minimalist' ? 'neo-minimalist' : 'classic';
const view = params.get('view') ?? 'home';
const store = params.get('store') ?? 'a';
const data = fixtureData(preset, true, 'normal');
const market = {
    code: `visual-local-${store}`,
    defaultLanguageCode: 'zh_Hans',
    currencyCode: 'MYR',
    countryCode: 'MY',
    locale: language === 'zh' ? 'zh-CN' : 'en-MY',
    label: `Local store ${store}`,
};
const palette = resolveStorefrontSemanticPalette(preset, {
    accentColor: store === 'a' ? '#f00000' : '#0000ff',
});
document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
document.documentElement.dataset.storefrontPreset = preset;
for (const [key, value] of Object.entries({
    ...semanticPaletteCssVariables(palette),
    ...storefrontSkinCssVariables(preset, palette),
}))
    document.documentElement.style.setProperty(key, value);
document.documentElement.style.colorScheme = preset === 'classic' ? 'light' : 'dark';
const image = data.storefrontContent.find(block => block.type === 'HERO').imageUrl;
const blocks = data.storefrontContent.filter(block =>
    ['HERO', 'QUICK_LINKS', 'TRUST_BAR', 'NOTICE'].includes(block.type),
);
const hero = blocks.find(block => block.type === 'HERO');
const heroes = [
    hero,
    ...[1, 2].map(index => ({
        ...hero,
        id: `${hero.id}-${index}`,
        position: index / 10,
        title: language === 'zh' ? `本地样本轮播 ${index + 1}` : `Local sample ${index + 1}`,
    })),
];
const contentBlocks = [...heroes, ...blocks.filter(block => block.type !== 'HERO')];
const program = {
    enabled: true,
    rewardRate: 3,
    releaseDelayDays: 7,
    currencyCode: 'MYR',
    posterTemplates: [],
    posterTemplateConfigs: [],
    systemPosterTemplateConfigs: [],
};
const overview = {
    rewardRate: 3,
    inviteCode: `LOCAL-${store}`,
    wallets: [
        {
            currencyCode: 'MYR',
            availableBalance: Number(params.get('available') ?? 12500),
            pendingBalance: Number(params.get('pending') ?? 2990),
        },
    ],
    rewardSummaries: [{ currencyCode: 'MYR', grossReward: 15490, clawedBackReward: 0 }],
    invitedCount: 2,
    purchasedInviteeCount: 1,
    ledger: [],
    invitees: [],
};
const api = {
    referralProgram: () => Promise.resolve(program),
    myReferralOverview: () => Promise.resolve(overview),
    imageStudioConfig: () => Promise.resolve(data.imageStudioConfig),
    imageStudioWallet: () => Promise.resolve(data.imageStudioWallet),
    imagePromptQuotaStatus: () => Promise.resolve(data.imagePromptQuotaStatus),
    imageModelQuotaStatus: () => Promise.resolve(data.imageModelQuotaStatus),
    myImageGenerationJobs: () => Promise.resolve({ items: [], totalItems: 0 }),
};
const noOp = () => undefined;
const home = {
    products: [],
    collections: [],
    contentBlocks,
    managedContentProducts: [],
    heroAutoplayIntervalSeconds: 3600,
    configuredBlockTypes: ['HERO', 'QUICK_LINKS', 'TRUST_BAR', 'NOTICE'],
    coupons: [],
    couponCampaignsLoading: false,
    couponCampaignsError: '',
    flashSales: [],
    systemAnnouncements: [],
    bestSellerProducts: [],
    recommendationProducts: [],
    contentError: '',
    loading: false,
    error: null,
    catalogLoading: false,
    catalogError: null,
    market,
    locale: market.locale,
    language,
    storefrontName: `Local store ${store}`,
    storefrontDescription: '',
    storefrontTagline: '',
    availableCurrencyCodes: ['MYR'],
    currencySelectorEnabled: false,
    displayCurrencyCode: 'MYR',
    currencyLoading: false,
    onCurrencyChange: noOp,
    logoUrl: null,
    logoOnLightUrl: null,
    couponLoading: false,
    onCategorySelect: noOp,
    onToggleLanguage: noOp,
    onNotifications: noOp,
    onClaimCoupon: () => Promise.resolve(null),
    onCouponCampaignsRetry: noOp,
    onContentTarget: noOp,
    onContentRetry: noOp,
    onRetry: noOp,
};
const support = {
    ...hero,
    id: 'local-support',
    code: 'local-support',
    type: 'SUPPORT',
    title: language === 'zh' ? '客服与帮助' : 'Support',
    subtitle: '',
    body: '',
    settings: {
        serviceDaysZh: '每日',
        serviceDaysEn: 'Daily',
        serviceStartTime: '10:00',
        serviceEndTime: '20:00',
        supportFaqs: [],
    },
    items: [
        {
            id: 'local-wechat',
            enabled: true,
            position: 0,
            label: language === 'zh' ? '微信客服' : 'WeChat support',
            description: '',
            imageUrl: image,
            targetType: 'NONE',
            targetValue: null,
            settings: { supportChannel: 'WECHAT', supportAccount: 'LOCAL-ONLY' },
        },
    ],
};
function Fixture() {
    const desktop = useDesktopViewport();
    useEffect(() => {
        const cleanup = trackFixedBottomBars();
        const viewport = trackFixedBottomViewport();
        return () => {
            cleanup();
            viewport();
        };
    }, []);
    const context = {
        language,
        route: { name: view === 'studio' ? 'image-studio' : view },
        customer: data.activeCustomer,
    };
    return (
        <DesktopLayoutContext.Provider value={desktop}>
            <StorefrontContext.Provider value={context as any}>
                <OverlayHost ownerKey={`${store}:${language}:${view}`}>
                    <div
                        className={`storefront-app${desktop ? ' desktop-store-layout' : ''}`}
                        data-local-synthetic="true"
                    >
                        {view === 'home' ? (
                            <HomePageContext.Provider value={home as any}>
                                <HomePage />
                            </HomePageContext.Provider>
                        ) : view === 'referral' ? (
                            <ReferralPageContext.Provider
                                value={
                                    {
                                        api,
                                        customer: data.activeCustomer,
                                        market,
                                        locale: market.locale,
                                        language,
                                        storefrontName: `Local store ${store}`,
                                        logoUrl: null,
                                        onBack: noOp,
                                        onNotify: noOp,
                                        onLogin: noOp,
                                    } as any
                                }
                            >
                                <ReferralPage />
                            </ReferralPageContext.Provider>
                        ) : view === 'support' ? (
                            <Subpage
                                title={language === 'zh' ? '本地客服样本' : 'Local support sample'}
                                language={language}
                                onBack={noOp}
                            >
                                <SupportContent content={support} language={language} />
                            </Subpage>
                        ) : (
                            <AiImageStudioPage
                                api={api as any}
                                customer={data.activeCustomer}
                                market={market}
                                displayCurrencyCode="MYR"
                                language={language}
                                onBack={noOp}
                                onSignIn={noOp}
                                onNotify={noOp}
                            />
                        )}
                    </div>
                </OverlayHost>
            </StorefrontContext.Provider>
        </DesktopLayoutContext.Provider>
    );
}
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const route = createRootRoute({ component: Fixture });
const router = createRouter({ routeTree: route, history: createMemoryHistory({ initialEntries: ['/'] }) });
createRoot(document.getElementById('root')).render(
    <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
    </QueryClientProvider>,
);
