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
                request: (query, variables, signal, timeout, uncertain, currency, proof) =>
                    runtime.api.request(query, variables, signal, timeout, uncertain, false, currency, proof),
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
            productCollections={runtime.collections}
            productContentBlocks={runtime.contentBlocks}
            onViewProducts={collectionId => runtime.openContentTarget('COLLECTION', collectionId)}
            onContactSupport={() => runtime.navigate({ name: 'support' })}
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
