import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { HomePage } from '../../src/pages/home-page';
import { HomePageContext } from '../../src/storefront-page-contexts';
import '../../src/styles.css';
import '../../src/styles/desktop-layout.css';
import { StorefrontContentBlock, StorefrontContentSettings } from '../../src/types';

// Only this test entry point uses the isolated SQL.js Shop API on loopback.
const params = new URLSearchParams(location.search);
const token = params.get('channel') ?? '';
const apiOrigin = 'http://127.0.0.1:5299';
const query = `query BrowserStoreContent {
    storefrontContent {
        id code type enabled position startsAt endsAt imageUrl backgroundColor textColor
        targetType targetValue settings title subtitle body ctaLabel
        items { id enabled position imageUrl targetType targetValue settings label description }
    }
    storefrontContentSettings { heroAutoplayIntervalSeconds configuredBlockTypes }
}`;
function Fixture() {
    const [language, setLanguage] = useState<'zh' | 'en'>('zh');
    const [data, setData] = useState<{
        storefrontContent: StorefrontContentBlock[];
        storefrontContentSettings: StorefrontContentSettings;
    } | null>(null);
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
    }, [language, refresh]);
    const reload = () => {
        setError('');
        setRefresh(n => n + 1);
    };
    const blocks = (data?.storefrontContent ?? []).map(block => ({
        ...block,
        imageUrl: block.imageUrl ? apiOrigin + block.imageUrl : null,
    }));
    return (
        <HomePageContext.Provider
            value={{
                products: [],
                collections: [],
                managedContentProducts: [],
                bestSellerProducts: [],
                recommendationProducts: [],
                contentBlocks: blocks,
                configuredBlockTypes: data?.storefrontContentSettings.configuredBlockTypes ?? [],
                heroAutoplayIntervalSeconds: data?.storefrontContentSettings.heroAutoplayIntervalSeconds ?? 5,
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
                onToggleLanguage: () => setLanguage(value => (value === 'zh' ? 'en' : 'zh')),
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
            <HomePage />
        </HomePageContext.Provider>
    );
}
const router = createRouter({
    routeTree: createRootRoute({ component: Fixture }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
});
const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Storefront test root is missing');
createRoot(rootElement).render(<RouterProvider router={router} />);
