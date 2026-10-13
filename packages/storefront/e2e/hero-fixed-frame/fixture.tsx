// organize-imports-ignore -- Keep the production stylesheet cascade.
import type { MarketConfig, StorefrontContentBlock } from '../../src/types';
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
import { HomePage, type HomePageProps } from '../../src/pages/home-page';
import { HomePageContext } from '../../src/storefront-page-contexts';
import '../../src/storefront-styles';
import '../../src/commerce-styles';

// Real HomePage, HeroScene and shortcut components; all content and actions stay local.
// Queries: skin=classic|neo-minimalist, lang=zh|en, layout=overlay|editorial|campaign.
const params = new URLSearchParams(location.search);
const language = params.get('lang') === 'en' ? 'en' : 'zh';
const preset = params.get('skin') === 'neo-minimalist' ? 'neo-minimalist' : 'classic';
const requestedLayout = params.get('layout');
const layout =
    requestedLayout === 'editorial' || requestedLayout === 'campaign' ? requestedLayout : 'overlay';
const isZh = language === 'zh';
const palette = resolveStorefrontSemanticPalette(preset);
document.documentElement.lang = isZh ? 'zh-CN' : 'en';
document.documentElement.dataset.storefrontPreset = preset;
document.documentElement.style.colorScheme = preset === 'classic' ? 'light' : 'dark';
for (const [key, value] of Object.entries({
    ...semanticPaletteCssVariables(palette),
    ...storefrontSkinCssVariables(preset, palette),
})) {
    document.documentElement.style.setProperty(key, value);
}

// Existing repository furniture photograph: public/storefront/default-hero.webp (800 × 496).
// This fixture does not replace or download any production artwork.
const imageUrl = '/storefront/default-hero.webp';
const copy = isZh
    ? [
          {
              title: '把休息，留给自己',
              subtitle: 'FLASH CAST · BEDROOM INSPIRATION',
              body: '卧室搭配灵感，布置自己的休息空间。',
              ctaLabel: '探索卧室家具',
          },
          {
              title: '选对家具，住得更舒服',
              subtitle: 'FLASH CAST · HOME & LIVING',
              body: '从客厅到卧室，按空间挑选家具，了解尺寸、材质与配送安排。',
              ctaLabel: '浏览家具系列',
          },
          {
              title: '从日常起居到安静休息，为每个空间选择适合自己的家具',
              subtitle: 'FLASH CAST · COMPLETE FURNITURE GUIDE',
              body: '这是用于检查内部滚动的本地长文案。挑选家具前，请先测量房间、门口、走廊和电梯的尺寸，再比较沙发、床架与餐桌的材质、颜色及日常保养方式。留出通行空间，核对配送区域、安装条件和到货安排。全文必须能够在画框内部阅读，不能因为标题或说明变长而撑大外部轮播容器。读到这里后，仍应能够找到并操作下方按钮。',
              ctaLabel: '查看完整家具指南',
          },
      ]
    : [
          {
              title: 'Make room for rest',
              subtitle: 'FLASH CAST · BEDROOM INSPIRATION',
              body: 'Find bedroom inspiration and create a restful space of your own.',
              ctaLabel: 'Explore bedroom furniture',
          },
          {
              title: 'Choose furniture for a more comfortable home',
              subtitle: 'FLASH CAST · HOME & LIVING',
              body: 'From living room to bedroom, find furniture for your space and check dimensions, materials and delivery arrangements.',
              ctaLabel: 'Browse furniture collections',
          },
          {
              title: 'Find furniture that supports everyday living and gives every room space to breathe',
              subtitle: 'FLASH CAST · COMPLETE FURNITURE GUIDE',
              body: [
                  'This deliberately long local example checks reading inside the fixed frame.',
                  'Measure your room, doorways, hallways and lift before choosing a sofa, bed frame or dining table.',
                  'Compare materials, colours, care instructions and the space needed to move comfortably.',
                  'Review delivery coverage, assembly requirements and arrival arrangements.',
                  'Every sentence must remain available to read inside the frame while the outer carousel keeps its approved height.',
                  'The action below must still be reachable after reading the final sentence.',
              ].join(' '),
              ctaLabel: 'Read the complete furniture guide',
          },
      ];

const baseBlock: StorefrontContentBlock = {
    id: 'local-hero',
    code: 'local-hero',
    type: 'HERO',
    enabled: true,
    position: 0,
    startsAt: null,
    endsAt: null,
    imageUrl,
    imageAsset: { width: 800, height: 496 },
    backgroundColor: '#efe7da',
    textColor: '#252c35',
    targetType: 'URL',
    targetValue: '/local-only/furniture',
    settings: {
        heroArtworkLayout: layout,
        secondaryTextColor: '#414b54',
        mobileImageUrl: imageUrl,
        mobileImageWidth: 800,
        mobileImageHeight: 496,
    },
    title: '',
    subtitle: '',
    body: '',
    ctaLabel: '',
    items: [],
};
const heroes = copy.map((item, index): StorefrontContentBlock => ({
    ...baseBlock,
    ...item,
    id: `local-hero-${index + 1}`,
    code: `local-hero-${index + 1}`,
    position: index / 10,
    targetValue: `/local-only/furniture-${index + 1}`,
}));
const shortcutLabels = isZh
    ? ['客厅家具', '卧室家具', '餐厅家具', '家具指南', '配送安排']
    : ['Living room', 'Bedroom', 'Dining room', 'Furniture guide', 'Delivery'];
const shortcuts: StorefrontContentBlock = {
    ...baseBlock,
    id: 'local-quick-links',
    code: 'local-quick-links',
    type: 'QUICK_LINKS',
    position: 1,
    imageUrl: null,
    imageAsset: null,
    backgroundColor: null,
    textColor: null,
    targetType: 'NONE',
    targetValue: null,
    title: isZh ? '家具快捷入口' : 'Furniture shortcuts',
    settings: {},
    items: shortcutLabels.map((label, index) => ({
        id: `local-shortcut-${index + 1}`,
        enabled: true,
        position: index,
        imageUrl,
        targetType: 'URL',
        targetValue: `/local-only/shortcut-${index + 1}`,
        settings: {},
        label,
        description: isZh ? '本地合成快捷入口，仅记录点击次数' : 'Local sample; records clicks only',
    })),
};
const contentBlocks = [...heroes, shortcuts];
const market: MarketConfig = {
    code: 'local-hero-frame',
    defaultLanguageCode: 'zh_Hans',
    currencyCode: 'MYR',
    countryCode: 'MY',
    locale: isZh ? 'zh-CN' : 'en-MY',
    label: 'Local hero frame fixture',
};

function Fixture() {
    const desktop = useDesktopViewport();
    const [actionCount, setActionCount] = useState(0);
    const recordAction = () => setActionCount(count => count + 1);
    const home: HomePageProps = {
        products: [],
        collections: [],
        contentBlocks,
        managedContentProducts: [],
        heroAutoplayIntervalSeconds: 30,
        configuredBlockTypes: ['HERO', 'QUICK_LINKS'],
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
        storefrontName: 'FLASH CAST · 本地样例',
        storefrontDescription: '',
        storefrontTagline: '',
        logoUrl: null,
        logoOnLightUrl: null,
        couponLoading: false,
        availableCurrencyCodes: ['MYR'],
        currencySelectorEnabled: false,
        displayCurrencyCode: 'MYR',
        currencyLoading: false,
        onCategorySelect: recordAction,
        onToggleLanguage: recordAction,
        onCurrencyChange: recordAction,
        onNotifications: recordAction,
        onClaimCoupon: () => {
            recordAction();
            return Promise.resolve(null);
        },
        onCouponCampaignsRetry: recordAction,
        onContentTarget: recordAction,
        onContentRetry: recordAction,
        onRetry: recordAction,
    };
    return (
        <DesktopLayoutContext.Provider value={desktop}>
            <div
                className={`storefront-app${desktop ? ' desktop-store-layout' : ''}`}
                data-local-synthetic="true"
                data-fixture-layout={layout}
            >
                <HomePageContext.Provider value={home}>
                    <HomePage />
                </HomePageContext.Provider>
                <footer className="type-helper" style={{ margin: 'var(--space-16)' }}>
                    <p>
                        {isZh
                            ? '本地合成样例：真实首页组件，复用项目家具图片；操作仅记录计数。'
                            : 'Local sample: real homepage components and existing furniture artwork. Actions only update this counter.'}
                    </p>
                    <output data-testid="local-action-count" aria-live="polite">
                        {isZh ? '本地操作次数：' : 'Local actions: '}
                        {actionCount}
                    </output>
                </footer>
            </div>
        </DesktopLayoutContext.Provider>
    );
}

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const router = createRouter({
    routeTree: createRootRoute({ component: Fixture }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
});
const host = document.getElementById('root');
if (!host) throw new Error('Missing hero fixture root');
createRoot(host).render(
    <QueryClientProvider client={client}>
        <RouterProvider router={router} />
    </QueryClientProvider>,
);
