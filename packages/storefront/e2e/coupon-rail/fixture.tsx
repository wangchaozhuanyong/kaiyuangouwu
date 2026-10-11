// organize-imports-ignore -- Keep the production stylesheet cascade.
import type { StorefrontContentBlock, StorefrontCouponCampaign, StoreCustomerCoupon } from '../../src/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import {
    resolveStorefrontSemanticPalette,
    semanticPaletteCssVariables,
    storefrontSkinCssVariables,
} from '../../../storefront-content-plugin/src/shared/storefront-semantic-palette';
import { DesktopLayoutContext, useDesktopViewport } from '../../src/desktop-layout';
import { CouponCenterPage, type CouponCenterPageProps } from '../../src/pages/coupon-center-page';
import { HomePage, type HomePageProps } from '../../src/pages/home-page';
import { HomePageContext, CouponCenterPageContext } from '../../src/storefront-page-contexts';
import { CouponSheet } from '../../src/storefront-ui/cart-ui';
import '../../src/storefront-styles';
import '../../src/commerce-styles';

const params = new URLSearchParams(location.search);
const language = params.get('lang') === 'en' ? 'en' : 'zh';
const preset = params.get('skin') === 'neo-minimalist' ? 'neo-minimalist' : 'classic';
const view = params.get('view') || 'home';
const count = Math.max(1, Math.min(6, Number(params.get('count')) || 6));
const palette = resolveStorefrontSemanticPalette(preset);
document.documentElement.dataset.storefrontPreset = preset;
document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
for (const [key, value] of Object.entries({
    ...semanticPaletteCssVariables(palette),
    ...storefrontSkinCssVariables(preset, palette),
}))
    document.documentElement.style.setProperty(key, value);

const block: StorefrontContentBlock = {
    id: 'local-coupons',
    code: 'local-coupons',
    type: 'COUPONS',
    enabled: true,
    position: 0,
    startsAt: null,
    endsAt: null,
    imageUrl: null,
    backgroundColor: null,
    textColor: null,
    targetType: 'NONE',
    targetValue: null,
    title: language === 'zh' ? '优惠券专区' : 'Coupon Offers',
    subtitle: '',
    body: '',
    ctaLabel: '',
    items: [],
};
const names =
    language === 'zh'
        ? [
              'Codex专属福利券',
              '大客户专属福利',
              '新客首单满100减5',
              '精选商品专属优惠',
              '会员限时福利券',
              '高额优惠长金额示例',
          ]
        : [
              'Codex member benefit',
              'Exclusive customer savings',
              'First order welcome offer',
              'Selected product savings',
              'Limited member reward',
              'Long amount layout sample',
          ];
const coupons: StorefrontCouponCampaign[] = (['emerald', 'blue', 'gold', 'rose', 'emerald', 'gold'] as const)
    .slice(0, count)
    .map((tone, i) => ({
        id: `local-campaign-${i}`,
        name: names[i],
        kind: i === 1 ? 'ORDER_PERCENTAGE' : 'ORDER_FIXED',
        appearanceTheme: tone,
        startsAt: null,
        endsAt: null,
        claimStartsAt: null,
        claimEndsAt: null,
        validityDays: 30,
        minimumSpend: [100000, 300000, 10000, 100000, 20000, 0][i],
        currencyCode: 'CNY',
        discountAmount: [5000, 0, 500, 10000, 2000, 12345678900][i],
        discountRate: i === 1 ? 9.5 : null,
        remainingIssueCount: 10,
        claimed: false,
        claimable: true,
    }));
const owned: StoreCustomerCoupon[] = coupons.map((coupon, i) => ({
    id: `local-owned-${i}`,
    campaignId: coupon.id,
    campaignName: coupon.name,
    campaignKind: coupon.kind,
    appearanceTheme: coupon.appearanceTheme,
    status: i === 4 ? 'EXPIRED' : 'AVAILABLE',
    minimumSpend: coupon.minimumSpend,
    currencyCode: 'CNY',
    discountAmount: coupon.discountAmount,
    discountRate: coupon.discountRate,
    claimedAt: '2026-10-01T00:00:00Z',
    validFrom: '2026-10-01T00:00:00Z',
    validUntil: null,
    lockedAt: null,
    usedAt: null,
    returnedAt: null,
    expiredAt: i === 4 ? '2026-10-02T00:00:00Z' : null,
    lockedOrderId: null,
    usedOrderId: null,
    returnCount: 0,
    usable: i !== 4,
}));
const noop = () => undefined;
function Fixture() {
    const desktop = useDesktopViewport();
    const [claims, setClaims] = useState(0);
    const [cartOpen, setCartOpen] = useState(view === 'cart');
    const mockClaim = () => {
        setClaims(n => n + 1);
        return Promise.resolve(null);
    };
    const market = {
        code: 'local-coupon-layout',
        currencyCode: 'CNY',
        countryCode: 'CN',
        defaultLanguageCode: 'zh_Hans',
        locale: language === 'zh' ? 'zh-CN' : 'en',
        label: 'Local sample',
    };
    const homeProps: HomePageProps = {
        products: [],
        collections: [],
        contentBlocks: [block],
        managedContentProducts: [],
        heroAutoplayIntervalSeconds: 5,
        configuredBlockTypes: ['COUPONS'],
        coupons,
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
        storefrontName: '',
        storefrontDescription: '',
        storefrontTagline: '',
        availableCurrencyCodes: ['CNY'],
        currencySelectorEnabled: false,
        displayCurrencyCode: 'CNY',
        currencyLoading: false,
        onCurrencyChange: noop,
        logoUrl: null,
        logoOnLightUrl: null,
        couponLoading: false,
        onCategorySelect: noop,
        onToggleLanguage: noop,
        onNotifications: noop,
        onClaimCoupon: mockClaim,
        onCouponCampaignsRetry: noop,
        onContentTarget: noop,
        onContentRetry: noop,
        onRetry: noop,
    };
    const centerProps: CouponCenterPageProps = {
        coupons,
        myCoupons: owned,
        usageRecords: [],
        currencyCode: 'CNY',
        displayCurrencyCode: 'CNY',
        language,
        loading: false,
        campaignsLoading: false,
        campaignsError: '',
        myCouponsLoading: false,
        myCouponsError: '',
        usageRecordsLoading: false,
        usageRecordsError: '',
        onRetryCampaigns: noop,
        onRetryMyCoupons: noop,
        onRetryUsageRecords: noop,
        onClaim: mockClaim,
    };
    return (
        <QueryClientProvider client={client}>
            <DesktopLayoutContext.Provider value={desktop}>
                <div className={`storefront-app${desktop ? ' desktop-store-layout' : ''}`}>
                    <header style={{ maxWidth: 1280, margin: '0 auto', padding: '20px 16px' }}>
                        <p className="type-section">
                            {language === 'zh'
                                ? '优惠券原款 · 108px单行横滑'
                                : 'Original coupon design · Compact single row'}
                        </p>
                        <p className="type-helper">
                            {language === 'zh'
                                ? '实际共用组件 · 本地样例 · 不写入线上 · 未发布'
                                : 'Actual shared components · Local samples · No production writes · Not published'}
                        </p>
                        <nav className="type-action" style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
                            <a href={`?skin=${preset}&lang=${language}&view=home&count=${count}`}>
                                {language === 'zh' ? '首页' : 'Home'}
                            </a>
                            <a href={`?skin=${preset}&lang=${language}&view=center&count=${count}`}>
                                {language === 'zh' ? '优惠券中心' : 'Coupon center'}
                            </a>
                            <button onClick={() => setCartOpen(true)}>
                                {language === 'zh' ? '购物车选券' : 'Cart coupon picker'}
                            </button>
                        </nav>
                        <output data-testid="claim-counter" className="type-helper">
                            {language === 'zh' ? '模拟操作次数：' : 'Mock actions: '}
                            {claims}
                        </output>
                    </header>
                    {view === 'center' ? (
                        <CouponCenterPageContext.Provider value={centerProps}>
                            <CouponCenterPage />
                        </CouponCenterPageContext.Provider>
                    ) : (
                        <HomePageContext.Provider value={homeProps}>
                            <HomePage />
                        </HomePageContext.Provider>
                    )}
                    {cartOpen && (
                        <CouponSheet
                            coupons={owned}
                            orderId="local-order"
                            currencyCode="CNY"
                            language={language}
                            loading={false}
                            onApply={mockClaim}
                            onRemove={mockClaim}
                            onBrowseCoupons={noop}
                            onClose={() => setCartOpen(false)}
                        />
                    )}
                    <footer style={{ height: 900, padding: 16 }} className="type-helper">
                        {language === 'zh'
                            ? '留白用于上下滚动验收'
                            : 'Space for vertical scroll verification'}
                    </footer>
                </div>
            </DesktopLayoutContext.Provider>
        </QueryClientProvider>
    );
}
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const router = createRouter({
    routeTree: createRootRoute({ component: Fixture }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
});
const host = document.getElementById('root');
if (!host) throw new Error('Missing coupon fixture root');
createRoot(host).render(<RouterProvider router={router} />);
