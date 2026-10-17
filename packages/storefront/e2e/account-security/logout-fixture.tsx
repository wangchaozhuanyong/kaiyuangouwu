import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { AccountSecurityPage } from '../../src/account-security-page';
import { DesktopLayoutContext, useDesktopViewport } from '../../src/desktop-layout';
import { Feedback } from '../../src/Feedback';
import { languageCodeFor } from '../../src/i18n';
import { useRouteCustomerLogout } from '../../src/logout';
import { storefrontQueryKeys } from '../../src/query-client';
import { type StorefrontContextValue } from '../../src/StorefrontContext';
import { type ActiveCustomer, type MarketConfig, type StorefrontLanguage } from '../../src/types';

const syntheticCustomer = {
    id: 'logout-fixture',
    firstName: 'Local',
    lastName: 'QA',
    emailAddress: 'local@example.invalid',
    addresses: [],
    avatar: null,
} as unknown as ActiveCustomer;
const market = { code: 'local-logout-fixture', currencyCode: 'MYR' } as MarketConfig;

/** Local-only responses: this mode never creates a ShopApi request or external session. */
export function LogoutFixture() {
    const desktop = useDesktopViewport();
    const queryClient = useQueryClient();
    const language: StorefrontLanguage =
        new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'zh';
    const identityKey = storefrontQueryKeys.customer(
        storefrontQueryKeys.market(market),
        languageCodeFor(language),
    );
    const serverCustomer = useRef<ActiveCustomer | null>(syntheticCustomer);
    const [mode, setMode] = useState('failure');
    const [calls, setCalls] = useState(0);
    const [clears, setClears] = useState(0);
    const [onAccount, setOnAccount] = useState(true);
    const [notice, setNotice] = useState<{ message: string; type?: 'error' } | null>(null);
    const identity = useQuery({
        queryKey: identityKey,
        initialData: syntheticCustomer,
        queryFn: () => Promise.resolve(serverCustomer.current),
        staleTime: Infinity,
        retry: false,
    });
    const runtime = {
        api: {
            logout: async () => {
                setCalls(value => value + 1);
                await new Promise(resolve => setTimeout(resolve, 1500));
                if (mode === 'lost' || mode === 'success') serverCustomer.current = null;
                if (mode !== 'success') throw new Error('Synthetic response unavailable');
            },
        },
        market,
        customer: identity.data,
        customerLoadState: 'ready',
        language,
        clearPrivateQueryCache: () => setClears(value => value + 1),
        setCustomer: (value: ActiveCustomer | null) => queryClient.setQueryData(identityKey, value),
        notify: (value: string | { message: string; type?: 'error' }) =>
            setNotice(typeof value === 'string' ? { message: value } : value),
    } as unknown as StorefrontContextValue;
    const { logoutCustomer, logoutPending } = useRouteCustomerLogout(runtime);
    return (
        <DesktopLayoutContext.Provider value={desktop}>
            <Feedback runtime={runtime} />
            <div style={{ padding: 16 }}>
                <p>Local synthetic logout QA · No external requests</p>
                <label>
                    Response{' '}
                    <select
                        aria-label="Synthetic response"
                        value={mode}
                        disabled={logoutPending}
                        onChange={event => setMode(event.target.value)}
                    >
                        <option value="failure">Request failed</option>
                        <option value="success">Confirmed success</option>
                        <option value="lost">Server signed out; response lost</option>
                    </select>
                </label>
                <button type="button" disabled={logoutPending} onClick={() => void identity.refetch()}>
                    Check server identity
                </button>
                <button type="button" onClick={() => setOnAccount(value => !value)}>
                    {onAccount ? 'Go home' : 'Return to account'}
                </button>
                <output aria-label="QA counters">
                    Requests: {calls}; private cache clears: {clears}
                </output>
                {notice && <p role={notice.type === 'error' ? 'alert' : 'status'}>{notice.message}</p>}
            </div>
            <div className={`storefront-app${desktop ? ' desktop-store-layout' : ''}`}>
                <div id="storefront-content">
                    {!onAccount ? (
                        <p>Home fixture</p>
                    ) : identity.data ? (
                        <AccountSecurityPage
                            customer={identity.data}
                            language={language}
                            storefrontName="Local QA"
                            onBack={() => undefined}
                            onAvatarChange={() => Promise.resolve()}
                            onLogout={() => void logoutCustomer()}
                            logoutPending={logoutPending}
                        />
                    ) : (
                        <p role="status">Anonymous session confirmed</p>
                    )}
                </div>
            </div>
        </DesktopLayoutContext.Provider>
    );
}
