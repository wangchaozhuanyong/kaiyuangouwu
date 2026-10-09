import type { ShopApi } from '../../src/api';
import type { MarketConfig, StorefrontContentBlock, StorefrontSystemAnnouncement } from '../../src/types';
// organize-imports-ignore -- Preserve production shared stylesheet cascade.
import { QueryClientProvider } from '@tanstack/react-query';
import {
    createBrowserHistory,
    createMemoryHistory,
    createRootRoute,
    createRoute,
    createRouter,
    RouterProvider,
    useRouterState,
} from '@tanstack/react-router';
import { createRoot } from 'react-dom/client';

import {
    resolveStorefrontSemanticPalette,
    semanticPaletteCssVariables,
    storefrontSkinCssVariables,
} from '../../../storefront-content-plugin/src/shared/storefront-semantic-palette';
import { DesktopAccountNavigation } from '../../src/components/common/desktop-account-navigation';
import { DesktopHeader } from '../../src/components/common/desktop-header';
import { DesktopLayoutContext, useDesktopViewport } from '../../src/desktop-layout';
import { AccountPage } from '../../src/pages/account-page';
import { HomePage } from '../../src/pages/home-page';
import { createStorefrontQueryClient } from '../../src/query-client';
import { AnnouncementsRoutePage } from '../../src/route-pages/announcements-route-page';
import {
    goBackInStorefront,
    registerStorefrontNavigationHistory,
    returnToStorefrontRoute,
} from '../../src/storefront-navigation-history';
import { AccountPageContext, HomePageContext } from '../../src/storefront-page-contexts';
import {
    normalizeRouteSearch,
    routeFromRouterLocation,
    routeNavigateOptions,
    type RouteState,
} from '../../src/storefront-router';
import { StorefrontContext, type StorefrontContextValue } from '../../src/StorefrontContext';
import '../../src/storefront-styles';
import '../../src/styles/account-catalog-surfaces.css';
import '../../src/styles/account-identity.css';
import '../../src/styles/control-surfaces.css';
import '../../src/styles/visual-presets.css';

// Production components and routing with synthetic read-only data. No server writes.
const params = new URLSearchParams(location.search);
const language = params.get('lang') === 'en' ? 'en' : 'zh';
const preset = params.get('skin') === 'neo-minimalist' ? 'neo-minimalist' : 'classic';
const isZh = language === 'zh';
const homePreview = params.get('view') === 'home';
const palette = resolveStorefrontSemanticPalette(preset);
document.documentElement.dataset.storefrontPreset = preset;
document.documentElement.lang = isZh ? 'zh-CN' : 'en';
for (const [key, value] of Object.entries({
    ...semanticPaletteCssVariables(palette),
    ...storefrontSkinCssVariables(preset, palette),
}))
    document.documentElement.style.setProperty(key, value);
const market: MarketConfig = {
    code: 'announcements-local-preview',
    defaultLanguageCode: 'zh_Hans',
    currencyCode: 'MYR',
    countryCode: 'MY',
    locale: isZh ? 'zh-CN' : 'en-US',
    label: 'Local preview',
};
const titles = isZh
    ? ['公告中心使用说明', '服务与订单信息查询指引', '账户安全提醒', '关于服务安排的说明']
    : [
          'Welcome to the announcements center',
          'Finding your service and order information',
          'Keeping your account secure',
          'A note about service availability',
      ];
const records: StorefrontSystemAnnouncement[] = Array.from({ length: 27 }, (_, i) => ({
    id: String(i + 1),
    title: i < 4 ? titles[i] : `${isZh ? '历史公告示例' : 'Earlier announcement sample'} ${i + 1}`,
    createdAt: new Date(Date.UTC(2026, 9, 9 - i * 45)).toISOString(),
    startsAt: null,
    endsAt: null,
    linkUrl: i === 0 ? '/support' : null,
    content: isZh
        ? '你可以在这里查看店铺发布的完整公告，了解服务安排与使用说明。\n\n公告按发布时间排列；点击下一页，可以继续查阅更早发布的内容。返回列表时，会保留所在页码。\n\n以上内容仅为本地设计验收样本，不代表真实店铺公告。'
        : [
              'Read complete store announcements here, including service information and helpful guidance.',
              'Announcements are ordered by publication date. Use Next to read earlier notices; returning to the list preserves your page.',
              'This is synthetic content for local design verification, not a published store announcement.',
          ].join('\n\n'),
}));
if (homePreview) {
    const shortIndex = params.has('shortFirst') ? 0 : 2;
    for (let index = 0; index < 4; index++) {
        records[index] = {
            ...records[index],
            title: isZh
                ? ['家具选购、询价及预购说明', '服务安排与订单查询指引', '账户安全提醒', '第四条历史公告'][
                      index
                  ]
                : [
                      'Furniture enquiries and pre-orders',
                      'Service and order information',
                      'Account safety',
                      'Fourth archived notice',
                  ][index],
            createdAt: new Date(Date.now() - (index + 1) * 86_400_000).toISOString(),
            content:
                index === shortIndex
                    ? isZh
                        ? '注意安全。'
                        : 'Stay safe.'
                    : isZh
                      ? '为方便选购，商品会根据销售方式展示价格或“联系客服询价”提示。询价时，请提供商品名称、所需规格、数量及配送地区，方便客服核对报价与供货情况。预购商品请先确认预计交付时间；不同款式、' +
                        '规格与数量可能影响报价和备货安排，具体以订单确认信息为准。公告正文读完后才会切换到下一条。以上仅为本地验收样本，未发布到店铺。'
                      : 'To help you choose, products display either a price or a contact-us-for-a-quote message. Please ' +
                        'include the product name, specification, quantity and delivery area when asking for a quote. Confirm ' +
                        'the estimated delivery time before placing a pre-order. Different options and quantities may affect ' +
                        'availability; refer to the order confirmation for the final details. The next announcement appears ' +
                        'only after the full message has finished. This is local test content and has not been published.',
        };
    }
}
const homeRecords =
    params.get('state') === 'empty'
        ? []
        : records.slice(0, params.has('count') ? Number(params.get('count')) : 4);
const noticeBlock: StorefrontContentBlock = {
    id: 'local-notice',
    code: 'local-notice',
    type: 'NOTICE',
    enabled: true,
    position: 0,
    startsAt: null,
    endsAt: null,
    imageUrl: null,
    backgroundColor: null,
    textColor: null,
    targetType: 'NONE',
    targetValue: null,
    title: params.has('legacyManual') ? '旧装修手填公告（本地样本）' : '',
    subtitle: '',
    body: params.has('legacyManual') ? '此装修字段应保留，但不得作为已发布系统公告播放。' : '',
    ctaLabel: '',
    items: [],
    settings: { scrollIntervalSeconds: Number(params.get('hold') || 5) },
};
let failOnce = params.get('state') === 'error';
const api = {
    contentReviewsApi: {
        announcements: ({ skip, take }: { skip: number; take: number }) => {
            if (failOnce) {
                failOnce = false;
                return Promise.reject(new Error('Local simulated read error'));
            }
            if (params.get('state') === 'empty') return Promise.resolve({ items: [], totalItems: 0 });
            return Promise.resolve({ items: records.slice(skip, skip + take), totalItems: records.length });
        },
        announcement: (id: string) => Promise.resolve(records.find(record => record.id === id) ?? null),
    },
    customerOrderCounts: () => Promise.resolve({ pending: 0, shipping: 0, receiving: 0, completed: 0 }),
    referralProgram: () => Promise.resolve({ enabled: false }),
    afterSalesRequests: () => Promise.resolve([]),
} as unknown as ShopApi;
const queryClient = createStorefrontQueryClient();
queryClient.setDefaultOptions({ queries: { retry: false } });
function Fixture() {
    const desktop = useDesktopViewport();
    const location = useRouterState({ select: state => state.location });
    const route = routeFromRouterLocation(location.pathname, location.search);
    const navigate = (next: RouteState, replace = false) =>
        void router.navigate({ ...routeNavigateOptions(next), replace } as never);
    const onBack = () => goBackInStorefront(router);
    const context = {
        api,
        route,
        language,
        locale: market.locale,
        market,
        customer: null,
        supportContent: undefined,
        reviewSettingsStatus: 'enabled',
        navigate,
        goBack: onBack,
        returnToRoute: (target: RouteState) => returnToStorefrontRoute(router, target),
        logoUrl: null,
        storefrontName: isZh ? '店铺预览' : 'Store preview',
        displayedRoute: route,
        contentBlocks: [],
        availableCurrencyCodes: [],
        currencySelectorEnabled: false,
        displayCurrencyCode: 'MYR',
        toggleLanguage: () => undefined,
        openContentTarget: (_type: string, value: string | null) => {
            if (value) navigate({ name: 'support' });
        },
    } as unknown as StorefrontContextValue;
    return (
        <DesktopLayoutContext.Provider value={desktop}>
            <StorefrontContext.Provider value={context}>
                <div
                    className={`storefront-app${desktop ? ' desktop-store-layout' : ''}`}
                    data-page-family={route.name === 'home' ? 'home' : 'content'}
                    data-route={route.name}
                >
                    <aside
                        className="type-helper"
                        style={{ padding: 'var(--space-12)', textAlign: 'center', color: 'var(--muted)' }}
                    >
                        {isZh
                            ? '本地预览 · 示例公告 · 未发布'
                            : 'Local preview · Sample announcements · Not published'}{' '}
                        ·{' '}
                        <a
                            href={`?lang=${isZh ? 'en' : 'zh'}&skin=${preset}${homePreview ? '&view=home' : ''}`}
                        >
                            {isZh ? 'English' : '中文'}
                        </a>{' '}
                        ·{' '}
                        <a
                            href={`?lang=${language}&skin=${preset === 'classic' ? 'neo-minimalist' : 'classic'}${homePreview ? '&view=home' : ''}`}
                        >
                            {isZh ? '切换皮肤' : 'Switch skin'}
                        </a>
                    </aside>
                    {desktop && <DesktopHeader cartQuantity={0} />}
                    <div
                        className={
                            desktop
                                ? `desktop-shell-frame${route.name === 'home' ? '' : ' desktop-account-layout'}`
                                : undefined
                        }
                    >
                        {desktop && route.name !== 'home' && <DesktopAccountNavigation />}
                        <div id="storefront-content">
                            {route.name === 'home' ? (
                                <HomePageContext.Provider
                                    value={{
                                        products: [],
                                        collections: [],
                                        managedContentProducts: [],
                                        bestSellerProducts: [],
                                        recommendationProducts: [],
                                        contentBlocks: [noticeBlock],
                                        configuredBlockTypes: ['NOTICE'],
                                        heroAutoplayIntervalSeconds: 5,
                                        coupons: [],
                                        flashSales: [],
                                        systemAnnouncements: homeRecords,
                                        couponCampaignsLoading: false,
                                        couponCampaignsError: '',
                                        couponLoading: false,
                                        loading: false,
                                        error: null,
                                        catalogLoading: false,
                                        catalogError: null,
                                        contentError: '',
                                        language,
                                        locale: market.locale,
                                        market,
                                        storefrontName: context.storefrontName,
                                        storefrontDescription: '',
                                        storefrontTagline: '',
                                        logoUrl: null,
                                        logoOnLightUrl: null,
                                        availableCurrencyCodes: ['MYR'],
                                        currencySelectorEnabled: false,
                                        displayCurrencyCode: 'MYR',
                                        currencyLoading: false,
                                        onToggleLanguage: () => undefined,
                                        onCurrencyChange: () => undefined,
                                        onNotifications: () => undefined,
                                        onCategorySelect: () => undefined,
                                        onContentTarget: () => undefined,
                                        onClaimCoupon: () => Promise.resolve(null),
                                        onCouponCampaignsRetry: () => undefined,
                                        onContentRetry: () => undefined,
                                        onRetry: () => undefined,
                                    }}
                                >
                                    <HomePage />
                                </HomePageContext.Provider>
                            ) : route.name === 'account' ? (
                                <AccountPageContext.Provider
                                    value={
                                        {
                                            api,
                                            customer: null,
                                            products: [],
                                            market,
                                            locale: market.locale,
                                            language,
                                            storefrontName: context.storefrontName,
                                            logoUrl: null,
                                            favoriteProductCount: 0,
                                            couponCount: 0,
                                            accountRecommendations: { enabled: false },
                                            reviewEnabled: true,
                                            onContentTarget: () => undefined,
                                            onLogout: () => undefined,
                                        } as never
                                    }
                                >
                                    <AccountPage />
                                </AccountPageContext.Provider>
                            ) : (
                                <AnnouncementsRoutePage />
                            )}
                        </div>
                    </div>
                </div>
            </StorefrontContext.Provider>
        </DesktopLayoutContext.Provider>
    );
}
const rootRoute = createRootRoute({ component: Fixture, validateSearch: normalizeRouteSearch });
const routes = ['/', '/account', '/announcements', '/category', '/services', '/support', '/cart'].map(path =>
    createRoute({ getParentRoute: () => rootRoute, path }),
);
const initial = homePreview
    ? '/'
    : params.get('view') === 'account'
      ? '/account'
      : `/announcements${
            new URLSearchParams([...params].filter(([key]) => key === 'id' || key === 'page')).size
                ? `?${new URLSearchParams([...params].filter(([key]) => key === 'id' || key === 'page'))}`
                : ''
        }`;
const nativeHistory = params.get('nativeHistory') === '1';
const fixtureDocumentUrl = `${window.location.pathname}${window.location.search}`;
if (nativeHistory && !window.location.hash) {
    window.history.replaceState(window.history.state, '', `${fixtureDocumentUrl}#${initial}`);
}
const router = createRouter({
    routeTree: rootRoute.addChildren(routes),
    history: nativeHistory
        ? createBrowserHistory({
              parseLocation: () => {
                  const url = new URL(window.location.hash.slice(1) || initial, window.location.origin);
                  return {
                      href: `${url.pathname}${url.search}${url.hash}`,
                      pathname: url.pathname,
                      search: url.search,
                      hash: url.hash,
                      state: window.history.state,
                  };
              },
              createHref: href => `${fixtureDocumentUrl}#${href}`,
          })
        : createMemoryHistory({ initialEntries: [initial] }),
});
registerStorefrontNavigationHistory(router);
(window as unknown as { fixtureNavigation: object }).fixtureNavigation = {
    router,
    get route() {
        return routeFromRouterLocation(router.state.location.pathname, router.state.location.search);
    },
    get index() {
        return router.history.location.state.__TSR_index;
    },
};
const mount = document.getElementById('root');
if (!mount) throw new Error('Announcement fixture mount is missing');
createRoot(mount).render(
    <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
    </QueryClientProvider>,
);
