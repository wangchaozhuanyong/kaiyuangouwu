/* eslint-disable import/order -- The Prettier import organizer places type imports after runtime imports. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ActiveCustomer, MarketConfig } from '../../src/types';
/* eslint-enable import/order */

import { ShopApi } from '../../src/api';
import { DesktopLayoutContext, useDesktopViewport } from '../../src/desktop-layout';
import { ReviewCenterPage } from '../../src/review-pages';
import { applyStorefrontVisualPreset } from '../../src/use-storefront-visual-preset';

import '../../src/commerce-styles';
import '../../src/styles.css';
import '../../src/styles/control-surfaces.css';
import '../../src/styles/desktop-commerce.css';
import '../../src/styles/desktop-home.css';
import '../../src/styles/desktop-layout.css';
import '../../src/styles/desktop-pages.css';
import '../../src/styles/locale-preferences.css';
import '../../src/styles/subpage-content.css';
import '../../src/styles/visual-presets.css';

const params = new URLSearchParams(location.search);
const market: MarketConfig = {
    code: params.get('channel') ?? '',
    currencyCode: 'USD',
    countryCode: 'US',
    defaultLanguageCode: 'zh_Hans',
    locale: 'zh-CN',
    label: 'Local review fixture',
};
const api = new ShopApi(market);
applyStorefrontVisualPreset(document.documentElement, 'modern-oriental');

function Fixture() {
    const desktop = useDesktopViewport();
    const [customer, setCustomer] = useState<ActiveCustomer | null>(null);
    const [status, setStatus] = useState('正在登录本地测试账户');
    const [error, setError] = useState('');

    useEffect(() => {
        void (async () => {
            let phase = 'login';
            try {
                await api.login(params.get('email') ?? '', 'ReviewIsolationPass123!');
                phase = 'active customer';
                const active = await api.activeCustomer();
                if (!active) throw new Error('Local review customer did not load');
                setCustomer(active);
                setStatus('');
            } catch (cause) {
                setError(`${phase}: ${cause instanceof Error ? cause.message : String(cause)}`);
            }
        })();
    }, []);

    return (
        <DesktopLayoutContext.Provider value={desktop}>
            <div
                className={`storefront-app app-shell${desktop ? ' desktop-store-layout' : ''}`}
                data-route="reviews"
            >
                {error ? (
                    <p role="alert">{error}</p>
                ) : customer ? (
                    <ReviewCenterPage
                        api={api}
                        customer={customer}
                        market={market}
                        language="zh"
                        onBack={() => undefined}
                        onProduct={() => undefined}
                        onShop={() => undefined}
                        onSignIn={() => undefined}
                        onNotify={setStatus}
                    />
                ) : (
                    <p role="status">{status}</p>
                )}
                {customer && status && <p role="status">{status}</p>}
            </div>
        </DesktopLayoutContext.Provider>
    );
}

const root = document.getElementById('root');
if (!root) throw new Error('Review isolation fixture root is missing');
createRoot(root).render(
    <QueryClientProvider client={new QueryClient()}>
        <Fixture />
    </QueryClientProvider>,
);
