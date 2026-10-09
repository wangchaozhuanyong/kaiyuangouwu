import type { ShopApi } from '../../src/api';
import type { MarketConfig, StorefrontSystemAnnouncement } from '../../src/types';
// organize-imports-ignore -- Preserve production shared stylesheet cascade.
import { QueryClientProvider } from '@tanstack/react-query';
import {
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
import { createStorefrontQueryClient } from '../../src/query-client';
import { AnnouncementsRoutePage } from '../../src/route-pages/announcements-route-page';
import { AccountPageContext } from '../../src/storefront-page-contexts';
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
    const navigate = (next: RouteState) => void router.navigate(routeNavigateOptions(next) as never);
    const onBack = () => (router.history.canGoBack() ? router.history.back() : navigate({ name: 'account' }));
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
                    data-page-family="content"
                >
                    <aside
                        className="type-helper"
                        style={{ padding: 'var(--space-12)', textAlign: 'center', color: 'var(--muted)' }}
                    >
                        {isZh
                            ? '本地预览 · 示例公告 · 未发布'
                            : 'Local preview · Sample announcements · Not published'}{' '}
                        ·{' '}
                        <a href={`?lang=${isZh ? 'en' : 'zh'}&skin=${preset}`}>{isZh ? 'English' : '中文'}</a>{' '}
                        ·{' '}
                        <a
                            href={`?lang=${language}&skin=${preset === 'classic' ? 'neo-minimalist' : 'classic'}`}
                        >
                            {isZh ? '切换皮肤' : 'Switch skin'}
                        </a>
                    </aside>
                    {desktop && <DesktopHeader cartQuantity={0} />}
                    <div className={desktop ? 'desktop-shell-frame desktop-account-layout' : undefined}>
                        {desktop && <DesktopAccountNavigation />}
                        <div id="storefront-content">
                            {route.name === 'account' ? (
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
const initialId = params.get('id');
const initial =
    params.get('view') === 'account'
        ? '/account'
        : `/announcements${initialId ? `?id=${encodeURIComponent(initialId)}` : ''}`;
const router = createRouter({
    routeTree: rootRoute.addChildren(routes),
    history: createMemoryHistory({ initialEntries: [initial] }),
});
const mount = document.getElementById('root');
if (!mount) throw new Error('Announcement fixture mount is missing');
createRoot(mount).render(
    <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
    </QueryClientProvider>,
);
