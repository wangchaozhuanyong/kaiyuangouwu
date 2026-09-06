import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { ShopApi } from '../../src/api';
import { LoginPage, RegisterPage } from '../../src/auth-pages';
import { DesktopHeader } from '../../src/components/common/desktop-header';
import { DesktopLayoutContext, useDesktopCatalog } from '../../src/desktop-layout';
import { useStorefrontBrandColors, useStorefrontMetadata } from '../../src/hooks/useStorefrontDocument';
import { DesktopCatalogPage } from '../../src/pages/desktop-catalog-page';
import { HomePage } from '../../src/pages/home-page';
import { HomePageContext } from '../../src/storefront-page-contexts';
import { StorefrontContext, type StorefrontContextValue } from '../../src/StorefrontContext';
import '../../src/styles.css';
import '../../src/styles/desktop-catalog.css';
import '../../src/styles/desktop-layout.css';
import '../../src/styles/visual-presets.css';
import { StorefrontContentBlock, StorefrontContentSettings } from '../../src/types';
import { useStorefrontVisualPreset } from '../../src/use-storefront-visual-preset';

// Only this test entry point uses the isolated SQL.js Shop API on loopback.
const params = new URLSearchParams(location.search);
const initialToken = params.get('channel') ?? '';
const apiOrigin = 'http://127.0.0.1:5299';
const query = `query BrowserStoreContent {
    storefrontContent {
        id code type enabled position startsAt endsAt imageUrl backgroundColor textColor
        targetType targetValue settings title subtitle body ctaLabel
        items { id enabled position imageUrl targetType targetValue settings label description }
    }
    storefrontContentSettings { heroAutoplayIntervalSeconds configuredBlockTypes }
    storefrontBranding { backgroundColor primaryColor }
}`;
function Fixture() {
    const [token, setToken] = useState(initialToken);
    const [language, setLanguage] = useState<'zh' | 'en'>('zh');
    const [data, setData] = useState<{
        storefrontContent: StorefrontContentBlock[];
        storefrontContentSettings: StorefrontContentSettings;
        storefrontBranding: { backgroundColor: string | null; primaryColor: string | null };
    } | null>(null);
    const market = useMemo(
        () => ({
            code: token,
            currencyCode: 'USD',
            countryCode: 'US',
            defaultLanguageCode: 'en' as const,
            locale: 'en-US',
            label: 'Test',
        }),
        [token],
    );
    const api = useMemo(() => new ShopApi(market, language === 'zh' ? 'zh_Hans' : 'en'), [market, language]);
    const visual = useStorefrontVisualPreset(api, market, language);
    const desktop = useDesktopCatalog(visual.desktopLayout);
    const [catalogRoute, setCatalogRoute] = useState({ name: 'home' } as StorefrontContextValue['route']);
    const [error, setError] = useState('');
    const [refresh, setRefresh] = useState(0);
    useEffect(() => {
        let cancelled = false;
        setData(null);
        const locale = language === 'zh' ? 'zh_Hans' : 'en';
        void fetch(`${apiOrigin}/shop-api?languageCode=${locale}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'vendure-token': token, 'language-code': locale },
            body: JSON.stringify({ query }),
        })
            .then(response => response.json())
            .then(result => {
                if (result.errors) throw new Error(result.errors[0].message);
                if (!cancelled) setData(result.data);
            })
            .catch(reason => {
                if (!cancelled) setError(String(reason));
            });
        return () => {
            cancelled = true;
        };
    }, [language, refresh, token]);
    const reload = () => {
        setError('');
        setRefresh(n => n + 1);
    };
    const blocks = (data?.storefrontContent ?? []).map(block => ({
        ...block,
        imageUrl: block.imageUrl ? apiOrigin + block.imageUrl : null,
    }));
    const page = params.get('page');
    const storefrontName = params.get('name') ?? 'Store';
    useStorefrontBrandColors(
        data
            ? ({
                  brandBackgroundColor: data.storefrontBranding.backgroundColor,
                  brandPrimaryColor: data.storefrontBranding.primaryColor,
              } as Parameters<typeof useStorefrontBrandColors>[0])
            : undefined,
    );
    useStorefrontMetadata({
        isZh: language === 'zh',
        route: { name: page === 'register' ? 'register' : page === 'login' ? 'login' : 'home' },
        selectedProduct: null,
        storefrontDescription: '',
        storefrontName,
        logoUrl: null,
    });
    if (page === 'login' || page === 'register') {
        if (!data) return <p role="status">{error || 'Loading'}</p>;
        const AuthPage = page === 'login' ? LoginPage : RegisterPage;
        return (
            <>
                <button
                    className="language-button"
                    type="button"
                    onClick={() => setLanguage(current => (current === 'zh' ? 'en' : 'zh'))}
                >
                    中文 / English
                </button>
                <AuthPage
                    api={api}
                    language={language}
                    storefrontName={storefrontName}
                    logoUrl={null}
                    onBack={() => undefined}
                    onSuccess={() => Promise.resolve()}
                    authVisualContent={blocks.find(
                        block => block.type === (page === 'login' ? 'AUTH_LOGIN' : 'AUTH_REGISTER'),
                    )}
                />
            </>
        );
    }
    const runtime = {
        route: catalogRoute,
        api,
        market,
        collections: [],
        contentBlocks: blocks,
        language,
        locale: language === 'zh' ? 'zh-CN' : 'en-US',
        storefrontName,
        storefrontTagline: '',
        logoUrl: null,
        logoOnLightUrl: null,
        loading: !data,
        error,
        availableCurrencyCodes: ['USD'],
        currencySelectorEnabled: false,
        displayCurrencyCode: 'USD',
        cartLoading: false,
        navigate: setCatalogRoute,
        toggleLanguage: () => setLanguage(value => (value === 'zh' ? 'en' : 'zh')),
        switchCurrency: () => Promise.resolve(),
        refetchStorefront: () => {
            reload();
            return Promise.resolve();
        },
    } as unknown as StorefrontContextValue;
    return (
        <StorefrontContext.Provider value={runtime}>
            <DesktopLayoutContext.Provider value={desktop}>
                <div className={`storefront-app${desktop ? ' has-desktop-catalog' : ''}`}>
                    {params.get('stores') && (
                        <select
                            aria-label="测试切店"
                            value={token}
                            onChange={event => setToken(event.target.value)}
                        >
                            {(params.get('stores') ?? '').split(',').map(value => (
                                <option key={value}>{value}</option>
                            ))}
                        </select>
                    )}
                    {desktop && <DesktopHeader cartQuantity={0} />}
                    <div className={desktop ? 'desktop-store-layout' : undefined}>
                        <div className={desktop ? 'desktop-page-content' : undefined}>
                            <HomePageContext.Provider
                                value={{
                                    products: [],
                                    collections: [],
                                    managedContentProducts: [],
                                    bestSellerProducts: [],
                                    recommendationProducts: [],
                                    contentBlocks: blocks,
                                    configuredBlockTypes:
                                        data?.storefrontContentSettings.configuredBlockTypes ?? [],
                                    heroAutoplayIntervalSeconds:
                                        data?.storefrontContentSettings.heroAutoplayIntervalSeconds ?? 5,
                                    coupons: [],
                                    flashSales: [],
                                    systemAnnouncements: [],
                                    couponCampaignsLoading: false,
                                    couponCampaignsError: '',
                                    couponLoading: false,
                                    loading: !data && !error,
                                    error,
                                    contentError: '',
                                    language,
                                    locale: language === 'zh' ? 'zh-CN' : 'en-US',
                                    market: {
                                        code: 'test',
                                        currencyCode: 'USD',
                                        countryCode: 'US',
                                        defaultLanguageCode: 'en',
                                        locale: 'en-US',
                                        label: 'Test',
                                    },
                                    storefrontName: params.get('name') ?? 'Test store',
                                    storefrontDescription: '',
                                    storefrontTagline: '',
                                    logoUrl: null,
                                    availableCurrencyCodes: ['USD'],
                                    currencySelectorEnabled: false,
                                    displayCurrencyCode: 'USD',
                                    currencyLoading: false,
                                    onToggleLanguage: () =>
                                        setLanguage(value => (value === 'zh' ? 'en' : 'zh')),
                                    onCurrencyChange: () => undefined,
                                    onNotifications: () => undefined,
                                    onCategorySelect: () => undefined,
                                    onContentTarget: () => undefined,
                                    onClaimCoupon: () => Promise.resolve(null),
                                    onCouponCampaignsRetry: reload,
                                    onContentRetry: reload,
                                    onRetry: reload,
                                }}
                            >
                                <HomePage embedded={desktop} />
                            </HomePageContext.Provider>
                            {desktop && <DesktopCatalogPage />}
                        </div>
                    </div>
                </div>
            </DesktopLayoutContext.Provider>
        </StorefrontContext.Provider>
    );
}
const router = createRouter({
    routeTree: createRootRoute({ component: Fixture }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
});
const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Storefront test root is missing');
createRoot(rootElement).render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RouterProvider router={router} />
    </QueryClientProvider>,
);
