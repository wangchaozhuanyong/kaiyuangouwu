// organize-imports-ignore -- Preserve the production stylesheet cascade.
import type { StorefrontContentBlock } from '../../src/types';
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
import { BusinessServicesPage } from '../../src/pages/business-services-page';
import { BusinessServicesPageContext } from '../../src/storefront-page-contexts';
import '../../src/storefront-styles';
import '../../src/commerce-styles';

const params = new URLSearchParams(location.search);
const language = params.get('lang') === 'en' ? 'en' : 'zh';
const preset = params.get('skin') === 'neo-minimalist' ? 'neo-minimalist' : 'classic';
const palette = resolveStorefrontSemanticPalette(preset);
document.documentElement.dataset.storefrontPreset = preset;
document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
for (const [key, value] of Object.entries({
    ...semanticPaletteCssVariables(palette),
    ...storefrontSkinCssVariables(preset, palette),
}))
    document.documentElement.style.setProperty(key, value);

const block: StorefrontContentBlock = {
    id: 'local-services',
    code: 'storefront-client-plugins',
    type: 'CLIENT_PLUGINS',
    enabled: true,
    position: 0,
    startsAt: null,
    endsAt: null,
    imageUrl: 'http://127.0.0.1:8796/moyao-ai-logo-campaign-20261011/services-logos-16x9.png',
    imageAsset: { width: 1672, height: 941 },
    backgroundColor: null,
    textColor: '#ffffff',
    targetType: 'URL',
    targetValue: '/local-preview',
    title: language === 'zh' ? '模钥 AI 中转' : 'AI services',
    subtitle: '',
    body: language === 'zh' ? '多模型，充值未开放' : 'Multiple AI models',
    ctaLabel: language === 'zh' ? '进入服务' : 'Explore',
    settings: { businessServicesCopyVersion: 1, businessServicesHeroLayout: 'shared-banner' },
    items: [
        'category-coupon-entry',
        'category-support-entry',
        'ai-image-studio-entry',
        'two-factor-code-tool',
        'icloud-mail-query-entry',
    ].map((pluginCode, position) => ({
        id: pluginCode,
        enabled: !(params.get('only') === 'support' && pluginCode === 'category-coupon-entry'),
        position,
        imageUrl: null,
        targetType: 'NONE',
        targetValue: null,
        label: pluginCode,
        description: '',
        settings: { pluginCode, placement: 'BUSINESS_SERVICES_MAIN' },
    })),
};
const noop = () => undefined;
function Fixture() {
    const desktop = useDesktopViewport();
    const [actions, setActions] = useState<string[]>([]);
    return (
        <QueryClientProvider client={client}>
            <DesktopLayoutContext.Provider value={desktop}>
                <div
                    className={desktop ? 'storefront-app desktop-store-layout' : 'storefront-app'}
                    style={{ maxWidth: 1344, margin: 'auto' }}
                    data-route="services"
                >
                    <BusinessServicesPageContext.Provider
                        value={{
                            contentBlocks: [block],
                            language,
                            storefrontName: '本地验收样例',
                            logoUrl: null,
                            marketLabel: '本地验收',
                            displayCurrencyCode: 'CNY',
                            availableCurrencyCodes: ['CNY'],
                            currencyLoading: false,
                            onToggleLanguage: noop,
                            onCurrencyChange: noop,
                            onNotifications: noop,
                            onNavigate: route => setActions(prev => [...prev, route.name]),
                            onContentTarget: () => setActions(prev => [...prev, 'hero']),
                        }}
                    >
                        <BusinessServicesPage />
                    </BusinessServicesPageContext.Provider>
                    <p className="type-helper" style={{ padding: 16 }}>
                        实际组件 · 本地固定样例 · 未发布；模拟导航：
                        <output data-testid="navigation-log">{actions.join(', ') || '无'}</output>
                    </p>
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
if (!host) throw new Error('Missing fixture root');
createRoot(host).render(<RouterProvider router={router} />);
