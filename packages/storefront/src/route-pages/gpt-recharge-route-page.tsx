import { lazyRouteComponent, useNavigate, useSearch } from '@tanstack/react-router';
import { useMemo } from 'react';

import { GptRechargeApi } from '../api/gpt-recharge';
import { usePageRouteCommit } from '../page-readiness';

import { useRouteRuntime as useRuntime } from './shared';

const GptRechargePage = lazyRouteComponent(
    () => import('../client-plugins/gpt-recharge/gpt-recharge-page'),
    'GptRechargePage',
);

export function GptRechargeRoutePage() {
    usePageRouteCommit();
    const runtime = useRuntime();
    const search: Record<string, unknown> = useSearch({ strict: false });
    const rawTab = search.tab;
    const tab = rawTab === 'query' || rawTab === 'guide' ? rawTab : 'recharge';
    const navigate = useNavigate();
    const client = useMemo(
        () =>
            new GptRechargeApi({
                request: (query, variables, signal, timeout, uncertain, currency) =>
                    runtime.api.request(query, variables, signal, timeout, uncertain, false, currency),
            }),
        [runtime.api],
    );
    return (
        <GptRechargePage
            key={`${runtime.market.code}:${runtime.language}`}
            marketKey={`${runtime.market.code}:${runtime.market.currencyCode}`}
            client={client}
            language={runtime.language}
            localePreferences={{
                storefrontName: runtime.storefrontName,
                currencyCode: runtime.displayCurrencyCode,
                currencyCodes: runtime.currencySelectorEnabled ? runtime.availableCurrencyCodes : [],
                currencyLoading: runtime.cartLoading,
                onToggleLanguage: runtime.toggleLanguage,
                onCurrencyChange: runtime.switchCurrency,
            }}
            onBack={runtime.goBack}
            activeTab={tab}
            onTabChange={next =>
                void navigate({
                    to: '/gpt-recharge',
                    search: previous => ({ ...previous, tab: next }),
                    replace: true,
                })
            }
        />
    );
}
