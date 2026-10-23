// organize-imports-ignore -- Preserve the production stylesheet cascade.
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';

import {
    resolveStorefrontSemanticPalette,
    semanticPaletteCssVariables,
    storefrontSkinCssVariables,
} from '../../../storefront-content-plugin/src/shared/storefront-semantic-palette';
import { BottomNavigation } from '../../src/components/common/bottom-navigation';
import { DesktopHeader } from '../../src/components/common/desktop-header';
import { MobilePageHeader } from '../../src/components/common/mobile-page-header';
import { DesktopLayoutContext, useDesktopViewport } from '../../src/desktop-layout';
import { useOnlineStatus } from '../../src/hooks/useOnlineStatus';
import { PageReadinessBoundary } from '../../src/page-readiness';
import { PageSkeleton } from '../../src/route-loading';
import { StorefrontPageFrame } from '../../src/storefront-page-frame';
import { StorefrontContext, type StorefrontContextValue } from '../../src/StorefrontContext';
import { StorefrontUpdatePrompt } from '../../src/StorefrontUpdatePrompt';
import '../../src/storefront-styles';
import '../../src/commerce-styles';

// Actual shared components; synthetic document-version response only, no backend or writes.
// Run Vite with NODE_ENV=production so the real version-check effect is enabled.
const params = new URLSearchParams(location.search);
const language = params.get('lang') === 'en' ? 'en' : 'zh';
const isZh = language === 'zh';
const skin = params.get('skin') === 'neo-minimalist' ? 'neo-minimalist' : 'classic';
const palette = resolveStorefrontSemanticPalette(skin);
document.documentElement.dataset.storefrontPreset = skin;
document.documentElement.lang = isZh ? 'zh-CN' : 'en';
for (const [key, value] of Object.entries({
    ...semanticPaletteCssVariables(palette),
    ...storefrontSkinCssVariables(skin, palette),
}))
    document.documentElement.style.setProperty(key, value);
const realFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (
        url.origin === location.origin &&
        url.pathname === '/index.html' &&
        url.searchParams.has('__storefront_version')
    ) {
        return Promise.resolve(
            new Response('<script type="module" src="/assets/index-local-next.js"></script>', {
                headers: { 'content-type': 'text/html' },
            }),
        );
    }
    return realFetch(input, init);
};
const initialAssets = ['/assets/index-local-current.js'];
function Fixture() {
    const desktop = useDesktopViewport();
    const online = useOnlineStatus();
    const [pending, setPending] = useState(false);
    const [route, setRoute] = useState<'home' | 'services'>('home');
    const [cycle, setCycle] = useState(0);
    const start = () => {
        setRoute('services');
        setCycle(value => value + 1);
        setPending(true);
    };
    const context = {
        route: { name: route },
        displayedRoute: { name: route },
        language,
        storefrontName: isZh ? '本地验收样例' : 'Local sample',
        logoUrl: null,
        customer: null,
        locale: isZh ? 'zh-CN' : 'en-MY',
        market: { code: 'local-sample', currencyCode: 'MYR', countryCode: 'MY', locale: 'en-MY' },
        displayCurrencyCode: 'MYR',
        availableCurrencyCodes: [],
        currencySelectorEnabled: false,
        contentBlocks: [],
        api: { search: () => Promise.resolve({ items: [], totalItems: 0 }) },
        navigate: () => {
            setPending(false);
            setRoute('home');
        },
        goBack: () => setPending(false),
    } as unknown as StorefrontContextValue;
    return (
        <DesktopLayoutContext.Provider value={desktop}>
            <StorefrontContext.Provider value={context}>
                <PageReadinessBoundary
                    pending={false}
                    online={online}
                    navigationPreparing={pending}
                    requestKey={`${route}-${cycle}`}
                    language={language}
                    onRetry={start}
                    onNavigationRetry={start}
                    onBack={() => setPending(false)}
                >
                    <StorefrontPageFrame
                        routeName={route}
                        language={language}
                        desktop={desktop}
                        online={online}
                        storefrontName={context.storefrontName}
                        logoUrl={null}
                        displayCurrencyCode="MYR"
                        header={desktop ? <DesktopHeader cartQuantity={0} /> : undefined}
                        deferred={
                            params.has('update') ? (
                                <StorefrontUpdatePrompt
                                    language={language}
                                    route={route}
                                    initialAssetReferences={initialAssets}
                                />
                            ) : undefined
                        }
                    >
                        {!desktop && (
                            <MobilePageHeader
                                title={context.storefrontName}
                                storefrontName={context.storefrontName}
                                logoUrl={null}
                                language={language}
                                displayCurrencyCode="MYR"
                                onNotifications={() => undefined}
                            />
                        )}
                        <aside className="type-helper" style={{ padding: 16 }}>
                            {isZh ? '本地模拟 · 未发布' : 'Local simulation · Not published'} ·{' '}
                            <button onClick={start}>{isZh ? '模拟页面加载' : 'Simulate page loading'}</button>{' '}
                            ·{' '}
                            <button onClick={() => setPending(false)}>
                                {isZh ? '完成模拟读取' : 'Complete simulated read'}
                            </button>
                        </aside>
                        {pending ? (
                            <PageSkeleton variant="services" language={language} />
                        ) : (
                            <main className="page" style={{ minHeight: 1500 }}>
                                <p>{isZh ? '可用页面内容' : 'Available page content'}</p>
                            </main>
                        )}
                        <BottomNavigation
                            activeRoute={route}
                            cartQuantity={0}
                            language={language}
                            onNavigate={next => {
                                if (next.name === 'services') start();
                                else {
                                    setRoute('home');
                                    setPending(false);
                                }
                            }}
                        />
                    </StorefrontPageFrame>
                </PageReadinessBoundary>
            </StorefrontContext.Provider>
        </DesktopLayoutContext.Provider>
    );
}
const rootRoute = createRootRoute({ component: Fixture });
const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
});
const host = document.getElementById('root');
if (!host) throw new Error('Missing local fixture root');
createRoot(host).render(<RouterProvider router={router} />);
