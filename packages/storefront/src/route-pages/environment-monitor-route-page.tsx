import { lazyRouteComponent } from '@tanstack/react-router';

import { usePageRouteCommit } from '../page-readiness';
import { storefrontQueryKeys } from '../query-client';
import { storefrontErrorMessage } from '../storefront-errors';
import { AsyncRouteStatePage } from '../storefront-ui/page-shell';

import { registerRoutePreload, useRouteRuntime as useRuntime } from './shared';

const EnvironmentMonitorPage = lazyRouteComponent(
    () => import('../client-plugins/environment-monitor/environment-monitor-page'),
    'EnvironmentMonitorPage',
);

export function EnvironmentMonitorRoutePage() {
    usePageRouteCommit();
    const runtime = useRuntime();
    const enabled = runtime.contentBlocks.some(
        block =>
            block.enabled &&
            block.code === 'storefront-client-plugins' &&
            block.type === 'CLIENT_PLUGINS' &&
            block.items.some(
                item => item.enabled && item.settings?.pluginCode === 'environment-monitor-entry',
            ),
    );
    if (runtime.contentQuery.data === undefined)
        return (
            <AsyncRouteStatePage
                routeName="environment-monitor"
                state={runtime.contentQuery.isError ? 'error' : 'loading'}
                error={
                    runtime.contentQuery.isError
                        ? storefrontErrorMessage(runtime.contentQuery.error, runtime.language)
                        : ''
                }
                language={runtime.language}
                onBack={runtime.goBack}
                onRetry={() => void runtime.contentQuery.refetch({ cancelRefetch: false })}
            />
        );
    if (!enabled)
        return (
            <AsyncRouteStatePage
                routeName="environment-monitor"
                state="error"
                error={
                    runtime.language === 'zh'
                        ? '当前店铺尚未开启环境监测'
                        : 'Environment monitor is not enabled in this store'
                }
                language={runtime.language}
                onBack={runtime.goBack}
                onRetry={() => void runtime.contentQuery.refetch({ cancelRefetch: false })}
            />
        );
    return (
        <EnvironmentMonitorPage
            key={JSON.stringify([runtime.market.code, runtime.market.currencyCode, runtime.customer?.id])}
            api={runtime.api}
            marketScope={storefrontQueryKeys.market(runtime.market)}
            customerId={runtime.customer?.id}
            language={runtime.language}
            onBack={runtime.goBack}
            localeSettings={{
                currencyCode: runtime.displayCurrencyCode,
                currencyCodes: runtime.availableCurrencyCodes,
                currencyLoading: runtime.cartLoading,
                onToggleLanguage: runtime.toggleLanguage,
                onCurrencyChange: runtime.switchCurrency,
            }}
        />
    );
}

export const preloadEnvironmentMonitorRoutePage = registerRoutePreload(
    EnvironmentMonitorRoutePage,
    EnvironmentMonitorPage,
);
