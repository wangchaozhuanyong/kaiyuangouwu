/* eslint-disable import/order -- The Prettier import organizer places type imports after runtime imports. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type {
    ActiveCustomer,
    CustomerAvatarHistoryEntry,
    DataSubjectRequest,
    FraudRiskCase,
    MarketConfig,
} from '../../src/types';

import { AccountSecurityPage } from '../../src/account-security-page';
import { ShopApi } from '../../src/api';
import { DesktopLayoutContext, useDesktopViewport } from '../../src/desktop-layout';
import '../../src/styles.css';
import '../../src/styles/control-surfaces.css';
import '../../src/styles/desktop-commerce.css';
import '../../src/styles/desktop-home.css';
import '../../src/styles/desktop-layout.css';
import '../../src/styles/desktop-pages.css';
import '../../src/styles/locale-preferences.css';
import '../../src/styles/subpage-content.css';
import '../../src/styles/visual-presets.css';
import { applyStorefrontVisualPreset } from '../../src/use-storefront-visual-preset';
/* eslint-enable import/order */

// This fixture mounts the production component; every action uses the local Shop API.
const params = new URLSearchParams(location.search);
const market: MarketConfig = {
    code: params.get('channel') ?? '',
    currencyCode: 'MYR',
    countryCode: 'MY',
    defaultLanguageCode: 'zh_Hans',
    locale: 'zh-CN',
    label: 'Local account fixture',
};
const api = new ShopApi(market);
applyStorefrontVisualPreset(document.documentElement, 'modern-oriental');

function Fixture() {
    const desktop = useDesktopViewport();
    const [customer, setCustomer] = useState<ActiveCustomer | null>(null);
    const [avatarHistory, setAvatarHistory] = useState<CustomerAvatarHistoryEntry[]>([]);
    const [dataSubjectRequests, setDataSubjectRequests] = useState<DataSubjectRequest[]>([]);
    const [fraudRiskCases, setFraudRiskCases] = useState<FraudRiskCase[]>([]);
    const [error, setError] = useState('');

    const refreshAvatarHistory = async () => setAvatarHistory(await api.customerAvatarHistory());
    const refreshDataSubjectRequests = async () => setDataSubjectRequests(await api.dataSubjectRequests());
    const refreshFraudRiskCases = async () => setFraudRiskCases(await api.fraudRiskCases());

    useEffect(() => {
        void (async () => {
            await api.login(params.get('email') ?? '', 'AccountBrowserPass123!');
            const [nextCustomer, history, requests, cases] = await Promise.all([
                api.activeCustomer(),
                api.customerAvatarHistory(),
                api.dataSubjectRequests(),
                api.fraudRiskCases(),
            ]);
            setCustomer(nextCustomer);
            setAvatarHistory(history);
            setDataSubjectRequests(requests);
            setFraudRiskCases(cases);
        })().catch(reason => setError(String(reason)));
    }, []);

    return (
        <DesktopLayoutContext.Provider value={desktop}>
            <div className={`storefront-app${desktop ? ' desktop-store-layout' : ''}`}>
                <div id="storefront-content">
                    {error ? (
                        <p role="alert">{error}</p>
                    ) : customer ? (
                        <AccountSecurityPage
                            customer={customer}
                            language="zh"
                            storefrontName="大马通"
                            onBack={() => undefined}
                            onAvatarChange={async file => {
                                const avatar = await api.uploadCustomerAvatar(file);
                                setCustomer(current => (current ? { ...current, avatar } : current));
                                await refreshAvatarHistory();
                            }}
                            avatarHistory={avatarHistory}
                            onAvatarRestore={async retentionId => {
                                const avatar = await api.restoreCustomerAvatar(retentionId);
                                setCustomer(current => (current ? { ...current, avatar } : current));
                                await refreshAvatarHistory();
                            }}
                            onAvatarRemove={async () => {
                                await api.removeCustomerAvatar();
                                setCustomer(current => (current ? { ...current, avatar: null } : current));
                                await refreshAvatarHistory();
                            }}
                            dataSubjectRequests={dataSubjectRequests}
                            onDataExport={password => api.exportPersonalData(password)}
                            onRequestAccountClosure={async password => {
                                await api.requestAccountClosure(password);
                                await refreshDataSubjectRequests();
                            }}
                            onCancelAccountClosure={async () => {
                                await api.cancelAccountClosure();
                                await refreshDataSubjectRequests();
                            }}
                            fraudRiskCases={fraudRiskCases}
                            onAppealFraudRiskCase={async (id, reason) => {
                                await api.appealFraudRiskCase(id, reason);
                                await refreshFraudRiskCases();
                            }}
                            onLogout={() => void api.logout()}
                        />
                    ) : (
                        <p role="status">正在加载本地账户</p>
                    )}
                </div>
            </div>
        </DesktopLayoutContext.Provider>
    );
}

const router = createRouter({
    routeTree: createRootRoute({ component: Fixture }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
});
const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Account security fixture root is missing');
createRoot(rootElement).render(
    <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
    </QueryClientProvider>,
);
